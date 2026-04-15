-- ============================================================================
-- OpenSquad Core — Schema mínimo para leads + mensagens + eventos + tickets
-- ============================================================================
-- Este é o schema base consumido pelo agent-attack-lead.
-- Se você já tem um CRM, adapte pros seus nomes de tabelas.
-- ============================================================================

-- ── leads ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.opensquad_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identificação
  company_name TEXT NOT NULL,
  cnpj TEXT,
  phone TEXT,
  email TEXT,
  decision_maker_name TEXT,

  -- Localização
  city TEXT,
  state TEXT,
  website TEXT,
  linkedin_url TEXT,

  -- Classificação
  cnae_code TEXT,
  segment TEXT,
  company_size_estimate TEXT,
  employee_count_estimate INT,
  icp_score INT DEFAULT 50,

  -- Origem
  discovery_source TEXT,
  discovery_batch_id UUID,
  enrichment JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  tags TEXT[],

  -- Status workflow
  status TEXT DEFAULT 'discovered'
    CHECK (status IN (
      'discovered', 'contacted', 'replied_cold', 'replied_warm', 'replied_hot',
      'meeting_scheduled', 'trial_active', 'closed_won', 'closed_lost',
      'opt_out', 'blocked', 'dead'
    )),
  status_changed_at TIMESTAMPTZ DEFAULT now(),

  -- Contadores
  messages_sent_count INT DEFAULT 0,
  messages_received_count INT DEFAULT 0,

  -- Timestamps de contato
  first_contact_at TIMESTAMPTZ,
  last_contact_at TIMESTAMPTZ,
  opt_out_at TIMESTAMPTZ,

  -- Timestamps sistema
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_phone ON public.opensquad_leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON public.opensquad_leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_discovered ON public.opensquad_leads(created_at DESC) WHERE status = 'discovered';

-- ── mensagens ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.opensquad_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.opensquad_leads(id) ON DELETE CASCADE,

  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  message_type TEXT,

  content TEXT NOT NULL,
  content_hash TEXT,

  detected_intent TEXT,
  intent_confidence NUMERIC(3,2),

  sent_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_lead_created ON public.opensquad_messages(lead_id, created_at DESC);

-- ── eventos (audit trail) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.opensquad_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES public.opensquad_leads(id) ON DELETE CASCADE,

  event_type TEXT NOT NULL,
  severity TEXT DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  actor TEXT,
  description TEXT,
  payload JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_lead ON public.opensquad_events(lead_id, created_at DESC);

-- ── support tickets (escalação pra humano) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('api', 'admin', 'web_form')),
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'telegram', 'email', 'web', 'other')),

  from_phone TEXT,
  from_name TEXT,
  from_email TEXT,
  opensquad_lead_id UUID REFERENCES public.opensquad_leads(id) ON DELETE SET NULL,

  urgency TEXT NOT NULL DEFAULT 'medium'
    CHECK (urgency IN ('low', 'medium', 'high', 'critical')),
  subject TEXT,
  summary TEXT NOT NULL,
  conversation_snapshot JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'waiting_customer', 'resolved', 'cancelled')),
  assigned_to TEXT,
  resolved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_lead ON public.support_tickets(opensquad_lead_id);

-- ── subscription_plans (usado pela tool get-plans) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price_brl NUMERIC(10,2) NOT NULL,
  interval TEXT DEFAULT 'month' CHECK (interval IN ('month', 'year', 'one_time')),
  billing_period TEXT DEFAULT 'mensal',
  max_projects INT,
  max_boreholes INT,
  max_users INT,
  features JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── RLS (service_role only) ─────────────────────────────────────────────────
ALTER TABLE public.opensquad_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opensquad_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opensquad_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role full access to leads" ON public.opensquad_leads FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full access to messages" ON public.opensquad_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full access to events" ON public.opensquad_events FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full access to tickets" ON public.support_tickets FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Public read active plans" ON public.subscription_plans FOR SELECT USING (is_active = true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
