# Deploy — Guia passo-a-passo

## Pré-requisitos

- VPS Ubuntu 22.04+ (Contabo €5/mês serve, 2 vCPU / 2GB RAM / 30GB SSD)
- Chip WhatsApp dedicado
- Supabase project (free tier)
- Google AI Studio API key (Gemini)
- Backend Next.js rodando com os endpoints de [endpoints/](../endpoints/) deployados

---

## 1. VPS

```bash
# SSH na VPS
ssh root@sua-vps

# Clone o repo
git clone https://github.com/alcidesigorrr/agent-attack-lead.git /opt/agent
cd /opt/agent

# Gera .env
cp .env.example .env
nano .env
# Preencher TODAS as variáveis. Use:
#   openssl rand -hex 32      → pra EVO_API_KEY, N8N_ENCRYPTION_KEY, OPENCLAW_WEBHOOK_SECRET
#   openssl rand -base64 24   → pra POSTGRES_PASSWORD, N8N_ADMIN_PASSWORD

# Setup da VPS (UFW + Docker)
bash infrastructure/setup-vps.sh

# Sobe stack
bash infrastructure/install.sh
```

## 2. Supabase

```bash
# Do seu laptop (pra aplicar migrations)
cd /opt/agent
export DB_PASSWORD='sua-senha-supabase'  # dashboard → Project Settings → Database
cd scripts && npm install && cd ..
node scripts/apply-migrations.mjs
```

## 3. Prompt

```bash
# Edite o template antes:
nano prompts/ana-template.md
# Substitua [NOME_EMPRESA], [NICHO], etc

# Sobe pro DB:
AGENT_ID='ana-seubiz' DB_PASSWORD='xxx' node scripts/push-prompt.mjs prompts/ana-template.md
```

## 4. Endpoints Next.js

Copie [endpoints/](../endpoints/) pro seu projeto Next.js:

```
src/app/api/agents/ana/tools/get-plans/route.ts           ← endpoints/agents/ana/tools/get-plans.ts
src/app/api/agents/ana/tools/recommend-plan/route.ts      ← endpoints/agents/ana/tools/recommend-plan.ts
src/app/api/agents/ana/tools/check-lead-account/route.ts  ← endpoints/agents/ana/tools/check-lead-account.ts
src/app/api/agents/ana/tools/get-feature-info/route.ts    ← endpoints/agents/ana/tools/get-feature-info.ts
src/app/api/webhooks/opensquad/sync-message/route.ts      ← endpoints/webhooks/opensquad/sync-message.ts
src/app/api/webhooks/opensquad/update-context/route.ts    ← endpoints/webhooks/opensquad/update-context.ts
src/app/api/webhooks/opensquad/open-ticket/route.ts       ← endpoints/webhooks/opensquad/open-ticket.ts
```

Ajustes em cada arquivo:
- `@/lib/supabase-admin` → sua função de admin DB
- Nomes de tabelas (se não usar `opensquad_*`)
- Env var `OPENCLAW_WEBHOOK_SECRET` (mesmo do .env da VPS)

Deploy no seu host (Vercel, VPS, etc).

## 5. WhatsApp

```bash
# SSH tunnel pro n8n
ssh -L 5678:127.0.0.1:5678 root@sua-vps &

# Abra http://localhost:5678, crie conta admin no primeiro acesso

# Na VPS, cria instância Evolution:
curl -X POST http://localhost:8080/instance/create \
  -H "apikey: $EVO_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"instanceName\":\"ana-seubiz\",\"qrcode\":true,\"integration\":\"WHATSAPP-BAILEYS\"}"

# Busca QR code:
curl http://localhost:8080/instance/connect/ana-seubiz -H "apikey: $EVO_API_KEY"
# Copia string base64, abre https://codebeautify.org/base64-to-image-converter
# Escaneia com WhatsApp do chip dedicado
```

## 6. Workflows n8n

Criar as credentials primeiro no n8n UI (http://localhost:5678):

- **Evolution API** (tipo "Header Auth"): Name=`apikey`, Value=`$EVO_API_KEY`
- **Google Gemini(PaLM) Api** (tipo "Google PaLM API"): Value=`$GEMINI_API_KEY`

Pega os IDs das credentials criadas e ajusta nos workflows. Depois:

```bash
# Na VPS:
cd /opt/agent
bash scripts/deploy-workflows.sh
```

## 7. Configura perfil WhatsApp

```bash
AGENT_NAME="Ana | MinhaEmpresa" \
AGENT_STATUS="Atendimento 8-18h | site.com.br" \
bash scripts/whatsapp-profile-setup.sh

# Horário comercial WhatsApp Business:
# Manual no app (Menu → Ferramentas comerciais → Horário comercial)
```

## 8. Teste

Mandar mensagem pro número do chip de um celular diferente.

Deve:
- Ana fica "digitando" por alguns segundos
- Resposta chega com saudação humanizada
- Entry aparece em `opensquad_messages` no Supabase
- Entry aparece em `opensquad_leads` (auto-criado se novo)
- `lead_context` preenchido após 1-2 msgs

---

## Troubleshooting

### n8n não ativa workflow
→ Provavelmente falta `shared_workflow` entry. Ver [scripts/deploy-workflows.sh](../scripts/deploy-workflows.sh) que já trata disso.

### Gemini "model not found"
→ Atualize pro `gemini-2.0-flash` (stable) ou pegue lista de models disponíveis:
```bash
curl "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY"
```

### Ana não lê contexto
→ Verifica que o workflow tem os nodes `Get Lead Context`, `Get Plans (Tool)`, `Check Account (Tool)` conectados ANTES de `Build Prompt + History`.

### Sqlite READONLY no restart do n8n
→ Depois de editar direto no sqlite, ajusta perms:
```bash
chown 1000:1000 /var/lib/docker/volumes/*_n8n_data/_data/database.sqlite
chmod 644 /var/lib/docker/volumes/*_n8n_data/_data/database.sqlite
rm -f /var/lib/docker/volumes/*_n8n_data/_data/database.sqlite-{shm,wal}
```
