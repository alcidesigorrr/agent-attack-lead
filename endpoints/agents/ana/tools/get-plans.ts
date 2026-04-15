// ============================================================================
// PORTABILIDADE: Este arquivo foi gerado como template do agent-attack-lead.
// Para usar no seu Next.js:
//   1. Copie para src/app/api/<path>/route.ts no seu projeto
//   2. Substitua `@/lib/supabase-admin` pela sua função de DB
//   3. Ajuste nomes de tabelas/colunas se usar schema diferente de opensquad_*
// ============================================================================

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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SECRET = process.env.OPENCLAW_WEBHOOK_SECRET;

export const GET = async (req: Request) => {
  if (SECRET && req.headers.get("x-webhook-secret") !== SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await adminDb()
    .from("subscription_plans")
    .select("slug, name, price_brl, max_projects, max_boreholes, max_users, is_active, billing_period")
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
      billing: p.billing_period || "mensal",
    }));

  return NextResponse.json({
    planos: plans,
    observacao:
      "max_obras/max_furos = null significa ilimitado. 1 obra = 1 relatório final. 1 obra tem vários furos.",
  });
};
