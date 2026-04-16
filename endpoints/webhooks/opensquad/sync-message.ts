/**
 * POST /api/webhooks/opensquad/sync-message
 *
 * Webhook universal que o OpenClaw (hook interno) chama a cada mensagem
 * enviada ou recebida pela Ana (ou qualquer bot OpenClaw). Auto-cria lead
 * se não existir, grava mensagem em opensquad_messages, atualiza counters.
 *
 * Body:
 *   phone: string         (+55...)
 *   direction: "inbound" | "outbound"
 *   content: string
 *   channel?: string      (default: "whatsapp")
 *   message_type?: string (first_contact, reply, followup_1, etc)
 *   sent_at?: string      (ISO 8601)
 *   external_message_id?: string (id da msg no WhatsApp)
 *   sender_name?: string  (push name)
 *   metadata?: object
 *
 * Autenticação: via header X-Webhook-Secret (config em env OPENCLAW_WEBHOOK_SECRET)
 *
 * Idempotência: se external_message_id já existe em metadata, ignora.
 */

import { NextResponse } from "next/server";
import { adminDb } from "@/lib/supabase-admin";
import { normalizePhone, hashContent } from "@/lib/opensquad/db";
import type { OpenSquadLead } from "@/lib/opensquad/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SECRET = process.env.OPENCLAW_WEBHOOK_SECRET;

/** Normaliza phone pra buscar em ambos os formatos (com e sem 9 do DDD) */
function phoneVariants(raw: string): string[] {
  const normalized = normalizePhone(raw);
  if (!normalized) return [raw];

  const variants = new Set<string>([normalized]);

  // Se tem 13 dígitos (55 + DDD + 9 + 8dig), adiciona versão sem o 9
  if (normalized.length === 13 && normalized.startsWith("55")) {
    const ddd = normalized.slice(2, 4);
    const rest = normalized.slice(4);
    if (rest.startsWith("9") && rest.length === 9) {
      variants.add(`55${ddd}${rest.slice(1)}`); // sem o 9
    }
  }

  // Se tem 12 dígitos (55 + DDD + 8dig), adiciona versão COM o 9
  if (normalized.length === 12 && normalized.startsWith("55")) {
    const ddd = normalized.slice(2, 4);
    const rest = normalized.slice(4);
    if (rest.length === 8) {
      variants.add(`55${ddd}9${rest}`); // adiciona o 9
    }
  }

  return Array.from(variants);
}

export const POST = async (req: Request) => {
  try {
    // Auth
    if (SECRET) {
      const provided = req.headers.get("x-webhook-secret");
      if (provided !== SECRET) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
    }

    const body = await req.json();
    const {
      phone,
      direction,
      content,
      channel = "whatsapp",
      message_type,
      sent_at,
      external_message_id,
      sender_name,
      metadata = {},
    } = body as {
      phone?: string;
      direction?: "inbound" | "outbound";
      content?: string;
      channel?: string;
      message_type?: string;
      sent_at?: string;
      external_message_id?: string;
      sender_name?: string;
      metadata?: Record<string, unknown>;
    };

    if (!phone || !direction || !content) {
      return NextResponse.json(
        { error: "phone, direction, content são obrigatórios" },
        { status: 400 },
      );
    }

    if (!["inbound", "outbound"].includes(direction)) {
      return NextResponse.json(
        { error: "direction deve ser 'inbound' ou 'outbound'" },
        { status: 400 },
      );
    }

    const variants = phoneVariants(phone);

    // 0. Blacklist check (LGPD)
    const { data: blacklisted } = await adminDb()
      .rpc("opensquad_is_blacklisted", { p_phone: normalizePhone(phone) ?? phone })
      .maybeSingle();
    if (blacklisted === true) {
      return NextResponse.json(
        { error: "phone is blacklisted (LGPD)", skipped: "blacklisted" },
        { status: 200 },
      );
    }

    // 1. Busca lead existente (tenta todas as variantes de phone)
    const { data: existingLeads } = await adminDb()
      .from("opensquad_leads")
      .select("*")
      .in("phone", variants)
      .order("created_at", { ascending: false })
      .limit(1);

    let lead: OpenSquadLead;

    if (existingLeads && existingLeads.length > 0) {
      lead = existingLeads[0] as OpenSquadLead;
    } else {
      // 2. Auto-cria lead
      const normalizedPhone = normalizePhone(phone) ?? phone;

      const defaultStatus = direction === "inbound" ? "replied_warm" : "contacted";
      const autoTitle = sender_name
        ? `${sender_name} (WhatsApp)`
        : `Contato ${normalizedPhone}`;

      const { data: created, error: createError } = await adminDb()
        .from("opensquad_leads")
        .insert({
          company_name: autoTitle,
          phone: normalizedPhone,
          decision_maker_name: sender_name || null,
          status: defaultStatus,
          discovery_source: "manual",
          metadata: {
            auto_created_by: "sync-message-webhook",
            discovery_subtype: "whatsapp_auto",
            first_contact_direction: direction,
            external_phone: phone,
          },
          tags: ["auto-created"],
        })
        .select("*")
        .single();

      if (createError || !created) {
        return NextResponse.json(
          { error: `Falha ao criar lead: ${createError?.message}` },
          { status: 500 },
        );
      }

      lead = created as OpenSquadLead;
      console.log(
        `[sync-message] Auto-criou lead ${lead.id} pra ${normalizedPhone}`,
      );
    }

    // 3. Idempotência: se external_message_id já existe, não duplica
    if (external_message_id) {
      const { data: existingMsg } = await adminDb()
        .from("opensquad_messages")
        .select("id")
        .eq("lead_id", lead.id)
        .filter("metadata->>external_message_id", "eq", external_message_id)
        .maybeSingle();

      if (existingMsg) {
        return NextResponse.json({
          success: true,
          skipped: "duplicate",
          lead_id: lead.id,
          message_id: existingMsg.id,
        });
      }
    }

    // 4. Insere mensagem
    const messageMetadata = {
      ...metadata,
      ...(external_message_id ? { external_message_id } : {}),
      ...(sender_name ? { sender_name } : {}),
    };

    const resolvedMessageType =
      message_type ||
      (direction === "outbound"
        ? (lead.messages_sent_count ?? 0) === 0
          ? "first_contact"
          : "followup_1"
        : "reply");

    const { data: msg, error: msgError } = await adminDb()
      .from("opensquad_messages")
      .insert({
        lead_id: lead.id,
        direction,
        channel,
        message_type: resolvedMessageType,
        content,
        content_hash: hashContent(content),
        sent_at: sent_at || new Date().toISOString(),
        metadata: messageMetadata,
      })
      .select("*")
      .single();

    if (msgError || !msg) {
      return NextResponse.json(
        { error: `Falha ao inserir msg: ${msgError?.message}` },
        { status: 500 },
      );
    }

    // 5. Atualiza counters no lead
    const countField =
      direction === "outbound" ? "messages_sent_count" : "messages_received_count";
    const currentCount = Number(
      (lead as unknown as Record<string, number>)[countField] ?? 0,
    );

    const updates: Record<string, unknown> = {
      [countField]: currentCount + 1,
    };

    if (direction === "outbound") {
      updates.last_contact_at = new Date().toISOString();
      if (!lead.first_contact_at) {
        updates.first_contact_at = new Date().toISOString();
      }
    } else {
      updates.last_reply_at = new Date().toISOString();
      updates.last_reply_content = content.slice(0, 500);
    }

    await adminDb()
      .from("opensquad_leads")
      .update(updates)
      .eq("id", lead.id);

    // 6. Log em opensquad_events (audit trail)
    await adminDb()
      .from("opensquad_events")
      .insert({
        lead_id: lead.id,
        event_type:
          direction === "outbound" ? "message_sent" : "reply_received",
        severity: "info",
        actor: "openclaw_hook",
        description: `${resolvedMessageType} via ${channel}`,
        payload: {
          direction,
          channel,
          content_preview: content.slice(0, 100),
          external_message_id,
        },
      });

    return NextResponse.json({
      success: true,
      lead_id: lead.id,
      lead_company: lead.company_name,
      message_id: msg.id,
      auto_created_lead: existingLeads?.length === 0,
    });
  } catch (error) {
    console.error("[sync-message] Exception:", error);
    return NextResponse.json(
      {
        error: "erro interno",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
};
