// ============================================================================
// PORTABILIDADE: Este arquivo foi gerado como template do agent-attack-lead.
// Para usar no seu Next.js:
//   1. Copie para src/app/api/<path>/route.ts no seu projeto
//   2. Substitua `@/lib/supabase-admin` pela sua função de DB
//   3. Ajuste nomes de tabelas/colunas se usar schema diferente de opensquad_*
// ============================================================================

/**
 * POST /api/agents/ana/tools/check-lead-account
 *
 * Tool da Ana: verifica se o telefone do lead já tem conta no Sondar+.
 * Retorna plano atual, status do trial, limites de uso.
 * Mesma lógica do MCP lookup_user, simplificada pro Gemini.
 *
 * Body:
 *   phone: string (E.164 ou BR sem formatação)
 */
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SECRET = process.env.OPENCLAW_WEBHOOK_SECRET;

function phoneLast8(raw: string): string {
  return raw.replace(/\D/g, "").slice(-8);
}

export const POST = async (req: Request) => {
  if (SECRET && req.headers.get("x-webhook-secret") !== SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { phone?: string };
  if (!body.phone) {
    return NextResponse.json({ error: "phone obrigatório" }, { status: 400 });
  }

  const last8 = phoneLast8(body.phone);
  if (last8.length < 8) {
    return NextResponse.json(
      { error: "telefone precisa ter pelo menos 8 dígitos" },
      { status: 400 },
    );
  }

  const { data: companies } = await adminDb()
    .from("companies_registry")
    .select("id, name, owner_email, status, city, state")
    .ilike("phone", `%${last8}%`)
    .limit(3);

  if (!companies || companies.length === 0) {
    return NextResponse.json({
      tem_conta: false,
      mensagem:
        "Telefone não encontrado no Sondar+. É um lead novo (ainda não cadastrou).",
      sugestao: "offer_trial",
    });
  }

  const companyIds = companies.map((c) => c.id);
  const { data: subs } = await adminDb()
    .from("subscriptions")
    .select(
      `company_id, status, current_period_end, trial_ends_at,
       subscription_plans (slug, name, max_projects, max_boreholes, max_users, interval)`,
    )
    .in("company_id", companyIds)
    .order("created_at", { ascending: false });

  const now = new Date();

  const contas = companies.map((c) => {
    const sub = subs?.find((s) => s.company_id === c.id);
    const plan = sub?.subscription_plans as
      | {
          slug?: string;
          name?: string;
          max_projects?: number | null;
          max_boreholes?: number | null;
          max_users?: number | null;
          interval?: string;
        }
      | undefined;

    const trialEnd = sub?.trial_ends_at ? new Date(sub.trial_ends_at) : null;
    const trialActive = trialEnd ? trialEnd > now : false;

    return {
      empresa: c.name,
      email_owner: c.owner_email,
      cidade: c.city,
      uf: c.state,
      status_empresa: c.status,
      plano: plan
        ? {
            nome: plan.name,
            slug: plan.slug,
            intervalo: plan.interval,
            limites: {
              max_obras: plan.max_projects,
              max_furos: plan.max_boreholes,
              max_usuarios: plan.max_users,
            },
          }
        : null,
      assinatura: sub
        ? {
            status: sub.status,
            proximo_vencimento: sub.current_period_end,
            trial_ativo: trialActive,
            trial_termina_em: trialEnd?.toISOString() || null,
          }
        : null,
    };
  });

  return NextResponse.json({
    tem_conta: true,
    qtd_empresas: contas.length,
    contas,
  });
};
