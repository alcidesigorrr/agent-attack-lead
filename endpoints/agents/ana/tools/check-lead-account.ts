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
import { requireWebhookAuth } from "@/lib/opensquad/webhook-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";


function phoneLast8(raw: string): string {
  return raw.replace(/\D/g, "").slice(-8);
}

export const POST = async (req: Request) => {
    const authErr = requireWebhookAuth(req);
    if (authErr) return authErr;

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
      status_empresa: c.status,
      plano: plan ? { nome: plan.name, slug: plan.slug } : null,
      assinatura: sub
        ? {
            status: sub.status,
            trial_ativo: trialActive,
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
