/**
 * GET /api/agents/ana/tools/get-plans
 *
 * Tool da Ana: retorna planos vigentes do Sondar+ direto do DB.
 * Fonte da verdade = tabela subscription_plans (a mesma que o checkout Stripe usa).
 *
 * Auth: X-Webhook-Secret (OPENCLAW_WEBHOOK_SECRET)
 */
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/supabase-admin";
import { requireWebhookAuth } from "@/lib/opensquad/webhook-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";


export const GET = async (req: Request) => {
    const authErr = requireWebhookAuth(req);
    if (authErr) return authErr;

  const { data, error } = await adminDb()
    .from("subscription_plans")
    .select("slug, name, price_brl, max_projects, max_boreholes, max_users, is_active, interval")
    .eq("is_active", true)
    .order("price_brl", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Filtra só planos mensais/avulsos (exclui anuais pra Ana não confundir)
  const plans = (data || [])
    .filter((p) => !p.slug?.includes("annual"))
    .map((p) => ({
      slug: p.slug,
      nome: p.name,
      preco_brl: p.price_brl,
      max_obras: p.max_projects,
      max_furos: p.max_boreholes,
      max_usuarios: p.max_users,
      ilimitado: p.max_projects === null,
      billing: p.interval === "monthly" ? "mensal" : (p.interval === "yearly" ? "anual" : "avulso"),
    }));

  return NextResponse.json({
    planos: plans,
    observacao:
      "max_obras/max_furos = null significa ilimitado. 1 obra = 1 relatório final. 1 obra tem vários furos.",
  });
};
