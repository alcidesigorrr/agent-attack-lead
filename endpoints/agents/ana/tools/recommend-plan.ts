// ============================================================================
// PORTABILIDADE: Este arquivo foi gerado como template do agent-attack-lead.
// Para usar no seu Next.js:
//   1. Copie para src/app/api/<path>/route.ts no seu projeto
//   2. Substitua `@/lib/supabase-admin` pela sua função de DB
//   3. Ajuste nomes de tabelas/colunas se usar schema diferente de opensquad_*
// ============================================================================

/**
 * POST /api/agents/ana/tools/recommend-plan
 *
 * Tool da Ana: recebe volume do cliente e retorna plano recomendado.
 * Consulta DB pra mapear volume → plano sem alucinar preços.
 *
 * Body:
 *   monthly_reports: number (relatórios/obras por mês)
 *   avg_holes_per_report?: number (furos médios por relatório, default 5)
 *   team_size?: number (pessoas que vão usar, default 1)
 *
 * Retorna: plano recomendado + justificativa + planos alternativos
 */
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SECRET = process.env.OPENCLAW_WEBHOOK_SECRET;

export const POST = async (req: Request) => {
  if (SECRET && req.headers.get("x-webhook-secret") !== SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    monthly_reports?: number;
    avg_holes_per_report?: number;
    team_size?: number;
  };

  const reports = Number(body.monthly_reports) || 0;
  const avgHoles = Number(body.avg_holes_per_report) || 5;
  const team = Number(body.team_size) || 1;

  if (reports < 0) {
    return NextResponse.json(
      { error: "monthly_reports obrigatório e >= 0" },
      { status: 400 },
    );
  }

  // Busca planos ativos (exclui anuais)
  const { data } = await adminDb()
    .from("subscription_plans")
    .select("slug, name, price_brl, max_projects, max_boreholes, max_users")
    .eq("is_active", true)
    .order("price_brl", { ascending: true });

  const plans = (data || []).filter((p) => !p.slug?.includes("annual"));

  const monthlyHoles = reports * avgHoles;

  // Scoring: plano "cabe" se todos os limites forem atendidos
  const fits = (p: (typeof plans)[number]) => {
    if (p.max_projects != null && reports > p.max_projects) return false;
    if (p.max_boreholes != null && monthlyHoles > p.max_boreholes) return false;
    if (p.max_users != null && team > p.max_users) return false;
    return true;
  };

  // Pega o mais barato que cabe
  const recommended = plans.find(fits);

  // Planos alternativos (um tier acima e um abaixo)
  const recommendedIdx = recommended ? plans.indexOf(recommended) : -1;
  const tierAbove =
    recommendedIdx >= 0 ? plans[recommendedIdx + 1] ?? null : null;
  const tierBelow =
    recommendedIdx > 0 ? plans[recommendedIdx - 1] ?? null : null;

  const justify: string[] = [];
  if (recommended) {
    if (recommended.max_projects == null) {
      justify.push(`${recommended.name} é ilimitado → cabe qualquer volume`);
    } else {
      justify.push(
        `${reports} relatórios/mês ≤ ${recommended.max_projects} obras do plano`,
      );
      if (recommended.max_boreholes != null) {
        justify.push(
          `~${monthlyHoles} furos/mês ≤ ${recommended.max_boreholes} furos do plano`,
        );
      }
      if (recommended.max_users != null) {
        justify.push(
          `${team} usuário${team > 1 ? "s" : ""} ≤ ${recommended.max_users} do plano`,
        );
      }
    }
  }

  return NextResponse.json({
    input: {
      monthly_reports: reports,
      avg_holes_per_report: avgHoles,
      monthly_holes_estimate: monthlyHoles,
      team_size: team,
    },
    recomendado: recommended
      ? {
          nome: recommended.name,
          slug: recommended.slug,
          preco_brl: recommended.price_brl,
          max_obras: recommended.max_projects,
          max_furos: recommended.max_boreholes,
          max_usuarios: recommended.max_users,
          justificativa: justify,
        }
      : null,
    alternativas: {
      tier_acima: tierAbove
        ? {
            nome: tierAbove.name,
            preco_brl: tierAbove.price_brl,
            nota: "mais folga se o volume crescer",
          }
        : null,
      tier_abaixo: tierBelow
        ? {
            nome: tierBelow.name,
            preco_brl: tierBelow.price_brl,
            nota: "mais barato mas pode apertar os limites",
          }
        : null,
    },
  });
};
