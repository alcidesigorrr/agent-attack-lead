// ============================================================================
// PORTABILIDADE: Este arquivo foi gerado como template do agent-attack-lead.
// Para usar no seu Next.js:
//   1. Copie para src/app/api/<path>/route.ts no seu projeto
//   2. Substitua `@/lib/supabase-admin` pela sua função de DB
//   3. Ajuste nomes de tabelas/colunas se usar schema diferente de opensquad_*
// ============================================================================

/**
 * POST /api/agents/ana/tools/get-feature-info
 *
 * Tool da Ana: retorna descrição detalhada de uma feature do Sondar+.
 * Ana chama quando cliente pergunta "como funciona OCR?", "tem CroquiCAD?", etc.
 *
 * Body:
 *   feature: string (ocr | croquicad | perfil_3d | auditor_nbr | nbr_8036 | mobile | trial | full)
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SECRET = process.env.OPENCLAW_WEBHOOK_SECRET;

type Feature = {
  nome: string;
  resumo: string;
  detalhes: string;
  diferencial?: string;
};

const FEATURES: Record<string, Feature> = {
  ocr: {
    nome: "OCR de Boletins",
    resumo:
      "Tira foto do boletim de campo escrito à mão e a plataforma digitaliza automaticamente.",
    detalhes:
      "O sondador na obra tira uma foto do boletim de campo (manuscrito ou impresso) direto do celular. A IA reconhece camadas, profundidades, valores de golpes (N) e transcreve tudo pra um formulário digital já estruturado. Reduz 90% do retrabalho de digitação.",
    diferencial: "Único SaaS brasileiro com OCR especializado em boletim de sondagem.",
  },
  croquicad: {
    nome: "CroquiCAD",
    resumo:
      "Importa DWG/DXF da planta da obra e monta croqui de locação dos furos direto na plataforma.",
    detalhes:
      "Você sobe o arquivo CAD (DWG ou DXF) da planta da obra, a ferramenta renderiza na tela e você marca onde foi cada furo clicando. Gera o croqui final pronto pro relatório. Sem precisar abrir AutoCAD.",
    diferencial: "Elimina a dependência do AutoCAD/SketchUp pra montar croqui de locação.",
  },
  perfil_3d: {
    nome: "Perfil 3D",
    resumo: "Visualização 3D interativa do subsolo a partir dos furos.",
    detalhes:
      "Gera automaticamente a visualização 3D das camadas do subsolo com base nos furos preenchidos. Cliente pode rotacionar, dar zoom, isolar camadas. Diferencial forte na entrega pro cliente final.",
    diferencial: "Entrega percebida mais profissional que concorrentes que só mandam PDF.",
  },
  auditor_nbr: {
    nome: "Auditor NBR 6484:2020 em tempo real",
    resumo:
      "Valida o boletim conforme a norma ABNT NBR 6484:2020 enquanto você digita (Tipo A ou Tipo B).",
    detalhes:
      "A cada camada que você preenche, o sistema checa se está conforme a NBR 6484:2020. Aponta problemas em tempo real (valor N fora do esperado, profundidade inconsistente, etc). Funciona tanto pra sondagem Tipo A quanto Tipo B.",
    diferencial: "Nenhum concorrente tem auditor normativo em tempo real.",
  },
  nbr_8036: {
    nome: "NBR 8036 automática",
    resumo: "Calcula o mínimo de furos exigido pela norma baseado na área da obra.",
    detalhes:
      "Você informa a área do terreno e a plataforma calcula o número mínimo de furos exigido pela NBR 8036. Útil na fase de orçamento pra não subdimensionar a sondagem.",
  },
  mobile: {
    nome: "100% nuvem, mobile first",
    resumo: "Roda direto no tablet/celular do sondador na boca do furo.",
    detalhes:
      "Interface pensada pro sondador preencher os dados na obra mesmo, sem precisar passar pra Excel/Word depois. Sincroniza quando volta pro wifi.",
  },
  trial: {
    nome: "14 dias grátis + 1 relatório completo",
    resumo: "Trial sem cartão de crédito. Cria conta e já sai usando.",
    detalhes:
      "Cadastro em sondarmais.com.br. 14 dias de acesso a tudo (OCR, CroquiCAD, Perfil 3D, auditor) + pode gerar 1 relatório completo no plano Pessoal. Sem cartão.",
  },
  full: {
    nome: "Sondar+ completo",
    resumo:
      "Plataforma brasileira de relatórios de sondagem geotécnica (SPT, SPT-T, Trado) com auditoria ABNT em tempo real.",
    detalhes:
      "SaaS brasileiro que substitui Word/Excel/AutoCAD no dia a dia de quem faz sondagem. Boletim em 10 min (no Word leva 3h). OCR, CroquiCAD, Perfil 3D, auditor NBR, NBR 8036 auto, mobile first, 14 dias grátis sem cartão.",
  },
};

export const POST = async (req: Request) => {
  if (SECRET && req.headers.get("x-webhook-secret") !== SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { feature?: string };
  const key = (body.feature || "").toLowerCase().trim();

  if (!key) {
    return NextResponse.json({
      error: "feature obrigatório",
      disponiveis: Object.keys(FEATURES),
    });
  }

  const feature = FEATURES[key];
  if (!feature) {
    return NextResponse.json({
      encontrado: false,
      mensagem: `Feature '${key}' não está na base. Escolha entre: ${Object.keys(FEATURES).join(", ")}`,
      sugestao: "se cliente perguntou algo específico, escalar como technical_question",
    });
  }

  return NextResponse.json({ encontrado: true, feature });
};
