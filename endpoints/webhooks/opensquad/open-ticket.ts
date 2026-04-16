/**
 * POST /api/webhooks/opensquad/open-ticket
 *
 * Chamado pela Ana quando ela detecta que precisa escalar pra humano:
 *   - Interesse alto ("quero testar agora", "meu time é 5 pessoas")
 *   - Pergunta técnica que ela não sabe
 *   - Negociação de preço/desconto
 *   - Reclamação
 *
 * Cria support_ticket com opensquad_lead_id preenchido.
 * Notifica Telegram se configurado.
 *
 * Body:
 *   phone: string
 *   reason: "hot_interest" | "technical_question" | "negotiation" | "complaint" | "trial_request" | "custom"
 *   summary: string (resumo pra equipe)
 *   urgency?: "low" | "medium" | "high" | "critical"
 *
 * Auth: X-Webhook-Secret
 */
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/supabase-admin";
import { normalizePhone } from "@/lib/opensquad/db";
import { requireWebhookAuth } from "@/lib/opensquad/webhook-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT = process.env.TELEGRAM_CHANNEL_ID;

type Reason =
  | "hot_interest"
  | "technical_question"
  | "negotiation"
  | "complaint"
  | "trial_request"
  | "custom";

const REASON_META: Record<Reason, { icon: string; label: string; urgency: string }> = {
  hot_interest: { icon: "🔥", label: "LEAD QUENTE", urgency: "critical" },
  trial_request: { icon: "🎁", label: "PEDIU TRIAL", urgency: "high" },
  negotiation: { icon: "💰", label: "NEGOCIAÇÃO", urgency: "high" },
  technical_question: { icon: "🔧", label: "DÚVIDA TÉCNICA", urgency: "medium" },
  complaint: { icon: "⚠️", label: "RECLAMAÇÃO", urgency: "high" },
  custom: { icon: "💬", label: "ATENÇÃO HUMANA", urgency: "medium" },
};

function phoneVariants(raw: string): string[] {
  const normalized = normalizePhone(raw);
  if (!normalized) return [raw];
  const v = new Set<string>([normalized]);
  if (normalized.length === 13 && normalized.startsWith("55")) {
    v.add(`55${normalized.slice(2, 4)}${normalized.slice(5)}`);
  }
  if (normalized.length === 12 && normalized.startsWith("55")) {
    v.add(`55${normalized.slice(2, 4)}9${normalized.slice(4)}`);
  }
  return Array.from(v);
}

async function notifyTelegram(text: string): Promise<void> {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT,
        text,
        parse_mode: "Markdown",
      }),
    });
  } catch (e) {
    console.error("[open-ticket] Telegram error:", e);
  }
}

export const POST = async (req: Request) => {
  try {
    const authErr = requireWebhookAuth(req);
    if (authErr) return authErr;

    const body = await req.json();
    const { phone, reason, summary, urgency } = body as {
      phone?: string;
      reason?: Reason;
      summary?: string;
      urgency?: string;
    };

    if (!phone || !reason || !summary) {
      return NextResponse.json(
        { error: "phone, reason, summary obrigatórios" },
        { status: 400 },
      );
    }

    const meta = REASON_META[reason] || REASON_META.custom;
    const finalUrgency = urgency || meta.urgency;

    // Busca lead
    const { data: leads } = await adminDb()
      .from("opensquad_leads")
      .select("id, phone, company_name, city, decision_maker_name, lead_context, conversation_stage")
      .in("phone", phoneVariants(phone))
      .limit(1);

    if (!leads || leads.length === 0) {
      return NextResponse.json({ error: "lead não encontrado" }, { status: 404 });
    }
    const lead = leads[0];

    // Idempotência: se já tem ticket aberto desse lead com mesmo reason nas últimas 24h, não duplica
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await adminDb()
      .from("support_tickets")
      .select("id, status")
      .eq("opensquad_lead_id", lead.id)
      .in("status", ["open", "in_progress", "waiting_customer"])
      .gte("created_at", twentyFourHoursAgo)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({
        success: true,
        skipped: "duplicate_recent",
        ticket_id: existing[0].id,
      });
    }

    // Cria ticket
    const displayName =
      lead.decision_maker_name || lead.company_name || `Contato ${lead.phone}`;
    const subject = `${meta.icon} ${meta.label}: ${displayName}${
      lead.city ? ` (${lead.city})` : ""
    }`;

    const ticketSummary = [
      `Lead: ${displayName}`,
      `Telefone: ${lead.phone}`,
      lead.city ? `Cidade: ${lead.city}` : null,
      `Stage atual: ${lead.conversation_stage || "new"}`,
      `Motivo: ${meta.label}`,
      ``,
      `Resumo da Ana:`,
      summary,
    ]
      .filter(Boolean)
      .join("\n");

    const { data: ticket, error: ticketError } = await adminDb()
      .from("support_tickets")
      .insert({
        source: "api",
        channel: "whatsapp",
        urgency: finalUrgency,
        status: "open",
        subject,
        summary: ticketSummary,
        from_phone: lead.phone,
        from_name: displayName,
        opensquad_lead_id: lead.id,
        conversation_snapshot: { lead_context: lead.lead_context },
        metadata: {
          opened_by: "ana_bot",
          reason,
        },
      })
      .select("id")
      .single();

    if (ticketError || !ticket) {
      return NextResponse.json(
        { error: `Falha ao criar ticket: ${ticketError?.message}` },
        { status: 500 },
      );
    }

    // Atualiza lead: se hot → replied_hot + stage demo_request/negotiation
    const statusUpdate: Record<string, unknown> = {};
    if (reason === "hot_interest" || reason === "trial_request") {
      statusUpdate.status = "replied_hot";
    } else if (reason === "negotiation") {
      statusUpdate.status = "replied_hot";
      statusUpdate.conversation_stage = "negotiation";
    }

    if (Object.keys(statusUpdate).length > 0) {
      await adminDb().from("opensquad_leads").update(statusUpdate).eq("id", lead.id);
    }

    // Audit trail
    await adminDb().from("opensquad_events").insert({
      lead_id: lead.id,
      event_type: "ticket_opened",
      severity: finalUrgency === "critical" ? "warning" : "info",
      actor: "ana_bot",
      description: `${meta.label}: ${summary.slice(0, 200)}`,
      payload: {
        ticket_id: ticket.id,
        reason,
        urgency: finalUrgency,
      },
    });

    // Notifica Telegram
    const tgMsg = [
      `${meta.icon} *${meta.label}*`,
      ``,
      `*${displayName}* ${lead.city ? `(${lead.city})` : ""}`,
      `📱 \`${lead.phone}\``,
      `📋 Ticket \`${ticket.id.slice(0, 8)}\``,
      ``,
      `_${summary}_`,
    ].join("\n");
    await notifyTelegram(tgMsg);

    return NextResponse.json({
      success: true,
      ticket_id: ticket.id,
      lead_id: lead.id,
      urgency: finalUrgency,
    });
  } catch (error) {
    console.error("[open-ticket] Exception:", error);
    return NextResponse.json(
      {
        error: "erro interno",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
};
