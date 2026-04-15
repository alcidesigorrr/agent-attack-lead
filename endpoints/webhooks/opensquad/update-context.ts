// ============================================================================
// PORTABILIDADE: Este arquivo foi gerado como template do agent-attack-lead.
// Para usar no seu Next.js:
//   1. Copie para src/app/api/<path>/route.ts no seu projeto
//   2. Substitua `@/lib/supabase-admin` pela sua função de DB
//   3. Ajuste nomes de tabelas/colunas se usar schema diferente de opensquad_*
// ============================================================================

/**
 * POST /api/webhooks/opensquad/update-context
 *
 * Chamado pela Ana (n8n Handler Inbound) DEPOIS de enviar resposta ao lead.
 * Faz 2ª chamada Gemini "silenciosa" que:
 *   - Extrai pain_points, objeções, sinais da conversa
 *   - Determina novo stage do funil
 *   - Decide next_action
 *   - Atualiza opensquad_leads.lead_context + conversation_stage
 *
 * Body:
 *   phone: string  (E.164 ou variante sem 9)
 *   ai_context_json?: string  (JSON gerado pelo Gemini, se n8n já processou)
 *
 * Se ai_context_json não vier, o endpoint faz a chamada Gemini aqui mesmo.
 *
 * Auth: X-Webhook-Secret (OPENCLAW_WEBHOOK_SECRET)
 */
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/supabase-admin";
import { normalizePhone } from "@/lib/opensquad/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SECRET = process.env.OPENCLAW_WEBHOOK_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

type LeadContext = {
  persona_fit?: number;
  pain_points?: string[];
  objections?: string[];
  signals?: Record<string, unknown>;
  next_action?: string;
  last_summary?: string;
  updated_at?: string;
};

const VALID_STAGES = [
  "new",
  "discovery",
  "qualification",
  "demo_request",
  "trial_activated",
  "negotiation",
  "closed_won",
  "closed_lost",
  "opt_out",
] as const;
type Stage = (typeof VALID_STAGES)[number];

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

async function callGeminiForContext(
  history: Array<{ direction: string; content: string }>,
  currentContext: LeadContext,
  currentStage: Stage,
): Promise<{ context: LeadContext; stage: Stage; model: string } | null> {
  if (!GEMINI_API_KEY) return null;

  const historyText = history
    .slice()
    .reverse()
    .map((m) => `${m.direction === "outbound" ? "Ana" : "Cliente"}: ${m.content}`)
    .join("\n");

  const systemPrompt = `Você é um analista comercial. Analisa a conversa abaixo entre Ana (vendedora SaaS Sondar+) e um lead, e responde APENAS com JSON válido (sem markdown) contendo o contexto atualizado do lead.

Stages possíveis: new, discovery, qualification, demo_request, trial_activated, negotiation, closed_won, closed_lost, opt_out.

Stage atual: ${currentStage}
Contexto atual: ${JSON.stringify(currentContext)}

Formato de resposta (JSON puro, sem markdown):
{
  "stage": "<um dos stages>",
  "context": {
    "persona_fit": <0-100, baseado em se é ICP do Sondar+>,
    "pain_points": ["<dor 1>", "<dor 2>"],
    "objections": ["<objeção 1>"],
    "signals": {"uses_word": bool, "monthly_reports": int, "team_size": int, "segment": "<string>"},
    "next_action": "<ação curta>",
    "last_summary": "<resumo 1 frase>"
  }
}

ICP do Sondar+: escritórios/profissionais de sondagem geotécnica, engenharia civil, quem faz SPT/SPT-T/Trado. Usa Word hoje = sinal forte.`;

  const body = {
    system_instruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: `CONVERSA:\n${historyText}\n\nResponda apenas com o JSON.` }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 500,
      responseMimeType: "application/json",
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error("[update-context] Gemini error:", res.status, await res.text());
    return null;
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  try {
    const parsed = JSON.parse(raw);
    const stage = VALID_STAGES.includes(parsed.stage)
      ? (parsed.stage as Stage)
      : currentStage;
    return {
      stage,
      context: { ...parsed.context, updated_at: new Date().toISOString() },
      model: "gemini-2.0-flash",
    };
  } catch (e) {
    console.error("[update-context] Parse error:", e, "raw:", raw);
    return null;
  }
}

export const POST = async (req: Request) => {
  try {
    if (SECRET) {
      const provided = req.headers.get("x-webhook-secret");
      if (provided !== SECRET) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
    }

    const body = await req.json();
    const { phone } = body as { phone?: string };

    if (!phone) {
      return NextResponse.json({ error: "phone obrigatório" }, { status: 400 });
    }

    const variants = phoneVariants(phone);

    // Busca lead
    const { data: leads } = await adminDb()
      .from("opensquad_leads")
      .select("id, lead_context, conversation_stage, company_name")
      .in("phone", variants)
      .limit(1);

    if (!leads || leads.length === 0) {
      return NextResponse.json({ error: "lead não encontrado" }, { status: 404 });
    }

    const lead = leads[0];
    const currentContext = (lead.lead_context || {}) as LeadContext;
    const currentStage = (lead.conversation_stage || "new") as Stage;

    // Busca últimas 20 msgs pra contexto
    const { data: messages } = await adminDb()
      .from("opensquad_messages")
      .select("direction, content, created_at")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: "sem mensagens" }, { status: 400 });
    }

    // Chama Gemini pra atualizar contexto
    const result = await callGeminiForContext(messages, currentContext, currentStage);
    if (!result) {
      return NextResponse.json({ error: "falha ao gerar contexto" }, { status: 500 });
    }

    // Persiste no lead
    await adminDb()
      .from("opensquad_leads")
      .update({
        conversation_stage: result.stage,
        lead_context: result.context,
      })
      .eq("id", lead.id);

    // Audit trail
    await adminDb()
      .from("opensquad_context_updates")
      .insert({
        lead_id: lead.id,
        previous_stage: currentStage,
        new_stage: result.stage,
        previous_context: currentContext,
        new_context: result.context,
        model: result.model,
      });

    return NextResponse.json({
      success: true,
      lead_id: lead.id,
      previous_stage: currentStage,
      new_stage: result.stage,
      context: result.context,
    });
  } catch (error) {
    console.error("[update-context] Exception:", error);
    return NextResponse.json(
      {
        error: "erro interno",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
};
