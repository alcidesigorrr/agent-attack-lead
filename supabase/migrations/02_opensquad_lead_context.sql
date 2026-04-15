-- ============================================================================
-- OpenSquad Lead Context — Memória estruturada por lead
-- ============================================================================
-- Permite que Ana (ou qualquer agent) mantenha contexto rico por lead:
-- stage do funil, pain points, objeções, próxima ação, resumo de conversa.
-- Atualizado via 2ª chamada Gemini após cada resposta da Ana.
-- ============================================================================

-- 1) Colunas que faltavam (sync-message endpoint referencia elas mas não existiam)
ALTER TABLE public.opensquad_leads
  ADD COLUMN IF NOT EXISTS last_reply_content TEXT;
ALTER TABLE public.opensquad_leads
  ADD COLUMN IF NOT EXISTS last_reply_at TIMESTAMPTZ;

-- 2) Contexto estruturado por lead
ALTER TABLE public.opensquad_leads
  ADD COLUMN IF NOT EXISTS conversation_stage TEXT
    CHECK (conversation_stage IN (
      'new',              -- nunca respondeu
      'discovery',        -- primeira qualificação (segmento/volume)
      'qualification',    -- entendendo dor/contexto
      'demo_request',     -- pediu demo/mostrar
      'trial_activated',  -- testando a plataforma
      'negotiation',      -- discussão de preço/plano
      'closed_won',       -- virou cliente
      'closed_lost',      -- desistiu
      'opt_out'           -- pediu pra não receber mais
    ))
    DEFAULT 'new';

ALTER TABLE public.opensquad_leads
  ADD COLUMN IF NOT EXISTS lead_context JSONB DEFAULT '{}'::jsonb;
-- Estrutura esperada (Ana/Gemini atualiza):
-- {
--   "persona_fit": 0-100,
--   "pain_points": ["levo 3h pra fazer boletim", "time usa Word"],
--   "objections": ["preço alto", "medo de migração"],
--   "signals": {"uses_word": true, "monthly_reports": 15, "team_size": 5},
--   "next_action": "mandar link de trial",
--   "last_summary": "Engenheiro civil em SP, 15 relatórios/mês, dor com Word.",
--   "updated_at": "2026-04-15T20:30:00Z"
-- }

COMMENT ON COLUMN public.opensquad_leads.conversation_stage IS
  'Estágio do funil comercial. Atualizado pela Ana/agent após cada interação.';
COMMENT ON COLUMN public.opensquad_leads.lead_context IS
  'Contexto estruturado extraído da conversa (pain points, objeções, sinais, próxima ação).';

CREATE INDEX IF NOT EXISTS idx_leads_conversation_stage
  ON public.opensquad_leads(conversation_stage)
  WHERE conversation_stage NOT IN ('closed_lost', 'opt_out');

-- 3) Histórico de mudanças de contexto (audit trail pra entender aprendizado)
CREATE TABLE IF NOT EXISTS public.opensquad_context_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.opensquad_leads(id) ON DELETE CASCADE,
  triggered_by_message_id UUID REFERENCES public.opensquad_messages(id) ON DELETE SET NULL,
  previous_stage TEXT,
  new_stage TEXT,
  previous_context JSONB,
  new_context JSONB,
  model TEXT,                  -- gemini-2.0-flash, etc
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_context_updates_lead
  ON public.opensquad_context_updates(lead_id, created_at DESC);

ALTER TABLE public.opensquad_context_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access to context_updates"
  ON public.opensquad_context_updates FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4) Extensão em support_tickets pra rastrear origem Ana
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS opensquad_lead_id UUID REFERENCES public.opensquad_leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_support_tickets_opensquad_lead
  ON public.support_tickets(opensquad_lead_id)
  WHERE opensquad_lead_id IS NOT NULL;

COMMENT ON COLUMN public.support_tickets.opensquad_lead_id IS
  'Referência ao lead do OpenSquad quando o ticket foi aberto por Ana/agent.';
