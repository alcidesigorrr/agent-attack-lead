# agent-attack-lead

> Framework completo pra rodar um agent comercial no WhatsApp com prospecção outbound, conversa humanizada, memória conversacional e escalação pra humano.

Stack: **EvolutionAPI + n8n + Gemini (direto) + Supabase**.

Testado em produção: **Ana / Sondar+** — assistente comercial pra escritórios de sondagem geotécnica. Pode ser customizado pra qualquer nicho B2B.

---

## ⚡ Overview

O agente **Ana** (nome default, customizável) roda numa VPS barata (Contabo €5/mês) e:

1. **Prospecta** leads de forma agendada (Dispatcher) respeitando horário comercial
2. **Responde** mensagens inbound via webhook do Evolution → Gemini → WhatsApp (Handler Inbound)
3. **Enfileira** mensagens recebidas fora de horário e responde no próximo dia útil 9h (Wake-up Queue)
4. **Mantém contexto** por lead (stage do funil, pain points, objeções, sinais, resumo cumulativo)
5. **Escala pra humano** via ticket quando detecta interesse quente, negociação ou dúvida técnica que não sabe responder
6. **Humaniza** typing delay proporcional ao tamanho da msg, presença "composing", variações de texto, sem gírias/travessão

---

## 🏗️ Arquitetura

```
                       ┌──────────────────┐
     WhatsApp ────────▶│  EvolutionAPI    │──── webhook ────┐
                       │  (Baileys v2.3.7)│                 │
                       └──────────────────┘                 ▼
                              ▲                    ┌───────────────┐
                              │ send msg           │      n8n      │
                              └────────────────────│   workflows   │
                                                    └───────────────┘
                                                      │       │
                              ┌───────────────────────┘       │
                              ▼                                ▼
                  ┌───────────────────┐          ┌──────────────────────┐
                  │  Gemini Flash 2.0 │          │  Supabase (Postgres) │
                  │  (AI Studio API)  │          │  + REST API          │
                  └───────────────────┘          └──────────────────────┘
                                                      │
                                                      ▼
                                        ┌───────────────────────────┐
                                        │  Next.js API (seu CRM)    │
                                        │  - tools (planos, leads)  │
                                        │  - webhooks (ticket, ctx) │
                                        └───────────────────────────┘
```

**Containers na VPS:**

| Serviço | Função | Porta local |
|---------|--------|-------------|
| postgres | DB do EvolutionAPI (dados do WA) | 127.0.0.1:5432 |
| redis | Cache + presence state | 127.0.0.1:6379 |
| evolution | Gateway WhatsApp | 127.0.0.1:8080 |
| n8n | Orquestrador de workflows | 127.0.0.1:5678 |

Tudo em localhost. Acesso via **SSH tunnel**, sem expor domínio.

---

## 🚀 Setup rápido

### Pré-requisitos

- VPS Ubuntu 22.04+ com 2 vCPU / 2GB RAM (Contabo, Hetzner, etc)
- Chip WhatsApp dedicado (não use o pessoal, risco de ban)
- Supabase project (free tier serve)
- Google AI Studio API key (Gemini)
- (Opcional) Telegram bot pra notificar leads quentes

### Instalação

```bash
# 1. Clone o repo na VPS
git clone https://github.com/alcidesigorrr/agent-attack-lead.git
cd agent-attack-lead

# 2. Configure .env (veja .env.example)
cp .env.example .env
nano .env

# 3. Rode o setup da VPS (UFW + docker)
bash infrastructure/setup-vps.sh

# 4. Rode a instalação do stack
bash infrastructure/install.sh

# 5. Aplique migrations no Supabase
DB_PASSWORD='sua-senha-supabase' node scripts/apply-migrations.mjs

# 6. Suba o prompt da Ana pro DB
DB_PASSWORD='sua-senha-supabase' AGENT_ID='ana-seunegocio' node scripts/push-prompt.mjs prompts/ana-template.md

# 7. Importe workflows no n8n via SSH tunnel:
# ssh -L 5678:127.0.0.1:5678 root@sua-vps
# Abra http://localhost:5678 e importe os JSONs de n8n/workflows/
# OU use:
bash scripts/deploy-workflows.sh

# 8. Conecte WhatsApp escaneando QR code (no n8n ou via Evolution endpoint):
curl -X GET http://localhost:8080/instance/connect/seu-agent \
  -H "apikey: $EVO_API_KEY"

# 9. Configure perfil WhatsApp (nome, foto, status):
bash scripts/whatsapp-profile-setup.sh
```

### Deploy dos endpoints Next.js no seu backend

Copie os arquivos de [endpoints/](endpoints/) pra seu projeto Next.js em:

- `src/app/api/agents/ana/tools/` (get-plans, recommend-plan, check-lead-account, get-feature-info)
- `src/app/api/webhooks/opensquad/` (sync-message, update-context, open-ticket)

Adapte cada endpoint ao seu schema de DB (veja comentários no topo de cada arquivo).

---

## 📁 Estrutura do repo

```
agent-attack-lead/
├── docker-compose.yml          # 4-service stack
├── .env.example
├── infrastructure/
│   ├── setup-vps.sh            # UFW, Docker, Docker Compose
│   └── install.sh              # clone + start stack
├── n8n/workflows/              # 4 workflows JSON prontos
│   ├── 01-handler-inbound.json
│   ├── 02-dispatcher-outbound.json
│   ├── 03-wakeup-queue.json
│   └── 04-followup.json        # placeholder
├── supabase/migrations/        # schema do CRM + agent_prompts
├── prompts/
│   └── ana-template.md         # prompt v6 com placeholders
├── endpoints/                  # Next.js API routes (tools + webhooks)
├── scripts/                    # deploy, prompt push, tests
└── docs/
    ├── ARCHITECTURE.md         # visão geral
    ├── HUMANIZATION.md         # como evitar detecção de bot
    ├── DEPLOY.md               # guia passo-a-passo
    └── CUSTOMIZATION.md        # adaptar pra outro nicho
```

---

## 🧠 Sistema de contexto (como a Ana lembra da conversa)

Cada mensagem inbound, o Handler:

1. Busca **últimas 20 msgs** do lead no DB
2. Busca **lead_context JSONB** (pain_points, objeções, signals, next_action, last_summary)
3. Busca **conversation_stage** (new → discovery → qualification → demo_request → trial_activated → negotiation → closed)
4. Busca **planos vigentes** do DB (zero alucinação de preço)
5. Busca **status de conta** do lead (já é cliente? trial ativo?)
6. Injeta TUDO no prompt antes da chamada Gemini
7. Depois da resposta, 2ª chamada Gemini silenciosa **atualiza o lead_context**

Resultado: cliente some 30 dias e volta, a Ana sabe exatamente onde parou e sobre o que conversaram.

---

## 📞 Horários e resposta fora-de-horário

- **Handler Inbound**: só responde seg-sex 8h-18h (Brasília)
- **Fora disso**: msg é enfileirada em `opensquad_outbound_queue` com `scheduled_for` = próximo dia útil 9h
- **Wake-up Queue**: workflow que dispara às 9h seg-sex, processa a fila e envia resposta contextual tipo *"Oi João, bom dia! Vi sua msg de ontem à noite, sobre o que você perguntou..."*

Evita falar em horário que parece desespero. E o lead recebe resposta rápida no horário certo.

---

## 🔥 Escalação pra humano

A Ana inclui no final da resposta um **marker** (invisível ao cliente) quando precisa escalar:

```
<<ESCALAR:motivo:resumo>>
```

Motivos:
- `hot_interest` — lead quente ("quero testar agora")
- `trial_request` — pediu trial estendido
- `negotiation` — discussão de preço/desconto
- `technical_question` — dúvida técnica que Ana não sabe
- `complaint` — reclamação

O Handler extrai o marker, envia só o texto limpo pro cliente e chama `/api/webhooks/opensquad/open-ticket` criando um `support_ticket` + notificando Telegram.

---

## 🛡️ Humanização (anti-detecção)

- Typing presence: Ana fica "digitando" proporcional ao tamanho da msg (60ms/char + 800ms baseline, clamp 2-12s)
- Variações de saudação (3 variantes por msg de primeiro contato)
- Sem travessão (`—`), sem gírias de adolescente, sem frases-clichê de IA
- Delay 30-60s aleatório entre envios (Dispatcher)
- Respeita horário comercial estrito

Ver [docs/HUMANIZATION.md](docs/HUMANIZATION.md).

---

## 🎯 Adaptando pra outro nicho

Ver [docs/CUSTOMIZATION.md](docs/CUSTOMIZATION.md). Resumo:

1. Edite `prompts/ana-template.md` com seu nicho (substituir "Sondar+", "sondagem geotécnica", planos, features)
2. Adapte `endpoints/agents/ana/tools/*` ao seu schema de DB
3. Mude `agent_id` em `agent_prompts` (ex: de `opensquad-ana` pra `mybiz-vendedor`)
4. Importe workflows n8n e configure credentials do Gemini + Evolution
5. Configure WhatsApp profile (nome, foto, status) via `scripts/whatsapp-profile-setup.sh`

---

## 📜 Licença

MIT. Use, modifique, venda como serviço. Só não responsabilize a gente se der cancelamento do WhatsApp por uso agressivo (por isso todas as humanizações estão embutidas).

---

## 🙏 Créditos

Construído ao vivo em sessão Claude Code / VS Code por [@alcidesigorrr](https://github.com/alcidesigorrr), em cima de:

- [EvolutionAPI](https://github.com/EvolutionAPI/evolution-api) (gateway WhatsApp)
- [n8n](https://n8n.io) (orquestrador)
- [Supabase](https://supabase.com) (DB + REST)
- [Google AI Studio / Gemini](https://ai.google.dev) (LLM)
