-- ============================================================================
-- Agent Prompts + Outbound Queue (EvolutionAPI + n8n)
-- ============================================================================
-- Suporta edição ao vivo do prompt da Ana pelo Painel Admin + fila pra
-- outbound que respeita horário comercial.
-- ============================================================================

-- ============ AGENT PROMPTS (editável via Painel Admin) ============
CREATE TABLE IF NOT EXISTS agent_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identificação
  agent_id TEXT NOT NULL,              -- ex: 'opensquad-ana', 'sondar-suporte'
  version INTEGER NOT NULL,            -- incremento manual ou auto
  label TEXT,                          -- ex: 'v3 — com regra sem travessão'

  -- Conteúdo do prompt
  system_prompt TEXT NOT NULL,         -- prompt completo usado pelo AI Agent no n8n

  -- Metadata
  model_primary TEXT DEFAULT 'gemini-2.0-flash-exp',
  model_fallback TEXT,
  temperature NUMERIC(3,2) DEFAULT 0.4,
  max_tokens INTEGER DEFAULT 300,

  -- Status
  is_active BOOLEAN DEFAULT FALSE,     -- só um pode ser ativo por agent_id
  published_at TIMESTAMPTZ,
  published_by TEXT,                   -- email do admin
  notes TEXT,                          -- changelog desta versão

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (agent_id, version)
);

CREATE INDEX IF NOT EXISTS idx_agent_prompts_active
  ON agent_prompts(agent_id) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_agent_prompts_version
  ON agent_prompts(agent_id, version DESC);

-- Garante que só 1 versão fica ativa por agent
CREATE OR REPLACE FUNCTION enforce_single_active_prompt()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_active = TRUE THEN
    UPDATE agent_prompts
      SET is_active = FALSE
      WHERE agent_id = NEW.agent_id
        AND id != NEW.id
        AND is_active = TRUE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_single_active_prompt ON agent_prompts;
CREATE TRIGGER trg_single_active_prompt
  BEFORE INSERT OR UPDATE ON agent_prompts
  FOR EACH ROW EXECUTE FUNCTION enforce_single_active_prompt();

-- RLS
ALTER TABLE agent_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to agent_prompts"
  ON agent_prompts FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ============ OUTBOUND QUEUE (Dispatcher + Wake-up) ============
CREATE TABLE IF NOT EXISTS opensquad_outbound_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Alvo do disparo
  lead_id UUID REFERENCES opensquad_leads(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,

  -- Conteúdo planejado
  message_type TEXT NOT NULL CHECK (message_type IN (
    'first_contact', 'followup_1', 'followup_2',
    'reply_pending', 'handoff', 'custom'
  )),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',

  -- Agendamento
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  priority INTEGER DEFAULT 5,          -- 1 (urgente) a 10 (baixa)

  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'processing', 'sent', 'failed', 'cancelled', 'skipped'
  )),
  attempts INTEGER DEFAULT 0,
  last_error TEXT,

  -- Resultado
  sent_at TIMESTAMPTZ,
  external_message_id TEXT,
  n8n_execution_id TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbound_queue_pending
  ON opensquad_outbound_queue(scheduled_for, priority)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_outbound_queue_lead
  ON opensquad_outbound_queue(lead_id);

ALTER TABLE opensquad_outbound_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to opensquad_outbound_queue"
  ON opensquad_outbound_queue FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ============ Trigger pra updated_at ============
CREATE OR REPLACE FUNCTION update_agent_prompts_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_prompts_updated ON agent_prompts;
CREATE TRIGGER trg_agent_prompts_updated
  BEFORE UPDATE ON agent_prompts
  FOR EACH ROW EXECUTE FUNCTION update_agent_prompts_updated_at();


CREATE OR REPLACE FUNCTION update_outbound_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_outbound_queue_updated ON opensquad_outbound_queue;
CREATE TRIGGER trg_outbound_queue_updated
  BEFORE UPDATE ON opensquad_outbound_queue
  FOR EACH ROW EXECUTE FUNCTION update_outbound_queue_updated_at();


-- ============ Comentários ============
COMMENT ON TABLE agent_prompts IS 'Prompts do AI Agent editáveis pelo Painel Admin. Uma versão ativa por agent_id.';
COMMENT ON TABLE opensquad_outbound_queue IS 'Fila de mensagens agendadas para envio pelo n8n Dispatcher. Respeita business hours.';
