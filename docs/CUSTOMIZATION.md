# Customização — Adaptar pra outro nicho

Este template foi construído pro **Sondar+** (SaaS de sondagem geotécnica). Pra usar em outro negócio:

## 1. Prompt (prompts/ana-template.md)

### Trocar identidade

```markdown
Você é a **Ana**, gestora comercial do **MinhaEmpresa**. Conversa via WhatsApp com [PUBLICO_ALVO] pelo Brasil.
```

### Trocar tagline + features

Na seção `SOBRE O NEGÓCIO`:

```markdown
Tagline: "[SUA_TAGLINE]"

SaaS brasileiro de [NICHO]. [PROPOSTA_DE_VALOR].

- Site: [SITE]

**Features principais:**
- [FEATURE 1]
- [FEATURE 2]
- [FEATURE 3]
- [TRIAL]
```

### Trocar regras de preço

A seção `REGRAS DE PREÇO` diz pra Ana usar a tool `get-plans`. Os preços vêm do DB via endpoint — você **não precisa** editar esses valores no prompt. Só atualiza a tabela `subscription_plans` no Supabase.

### Trocar stages do funil

Na seção `STAGES DO FUNIL`, adapte pros estágios do seu ciclo. Exemplo SaaS B2C:

```markdown
- `new` — nunca respondeu
- `discovery` — respondeu, entendendo perfil
- `qualification` — entende dor
- `demo_request` — pediu demo
- `signup` — se cadastrou
- `active_trial` — testando
- `paid` — converteu
```

Ajuste também o CHECK constraint em `supabase/migrations/02_opensquad_lead_context.sql`.

### Trocar motivos de escalação

Na seção `QUANDO ESCALAR`, mantenha as 5 categorias gerais (`hot_interest`, `trial_request`, `negotiation`, `technical_question`, `complaint`) ou adicione motivos específicos do seu negócio.

---

## 2. Tools (endpoints/)

### get-plans

O script lê de `subscription_plans`. Se seu schema é diferente:

```typescript
// Ajustar:
.from("subscription_plans")  // ← sua tabela
.select("slug, name, price_brl, max_projects, ...")  // ← suas colunas
```

Mapeie os nomes no return pra manter compatível com o prompt.

### check-lead-account

Lê de `companies_registry` e `subscriptions`. Adapte pra sua tabela de accounts.

### recommend-plan

Lógica de **mapping volume → plano**. Adapte a regra de fit:

```typescript
const fits = (p) => {
  if (p.max_projects != null && reports > p.max_projects) return false;
  // ... sua lógica específica
};
```

### get-feature-info

Dicionário hardcoded de features no arquivo. Substitua o `FEATURES` object com as suas features.

Pra escalar, pode virar consulta a CMS (Sanity, Contentful) ou tabela `features` no Supabase.

---

## 3. Schema (supabase/migrations/)

Se você NÃO quer usar `opensquad_*` como prefix:

```bash
cd supabase/migrations
sed -i '' 's/opensquad_/seubiz_/g' *.sql
```

Aí atualize os endpoints correspondentes:

```bash
cd ../../endpoints
sed -i '' 's/opensquad_/seubiz_/g' **/*.ts
```

---

## 4. Workflows n8n

Os workflows usam placeholders que são substituídos pelo `deploy-workflows.sh`:

```
{{ SUPABASE_URL }}
{{ SUPABASE_SERVICE_ROLE_KEY }}
{{ GEMINI_API_KEY }}
{{ BACKEND_BASE_URL }}
{{ AGENT_ID }}
```

Se você mudou nomes de tabelas, edite os JSONs de [n8n/workflows/](../n8n/workflows/) buscando por `opensquad_` e substituindo.

### Trocar horário de atendimento

Arquivo `01-handler-inbound.json`, node **Business Hours Check**:

```javascript
// Hoje: 8-18 seg-sex
const isBusinessHour = hour >= 8 && hour < 18;
const isWeekday = !['Sat', 'Sun'].includes(weekday);

// Ex: 9-19 seg-sáb
const isBusinessHour = hour >= 9 && hour < 19;
const isWeekday = weekday !== 'Sun';
```

E o schedule do Wake-up Queue (`03-wakeup-queue.json`):

```
"expression": "0 9 * * 1-5"  // 9h seg-sex
// Pra 10h seg-sáb: "0 10 * * 1-6"
```

### Trocar schedule do Dispatcher

`02-dispatcher-outbound.json`, node **Schedule 9h/11h/15h**:

```
"expression": "0 9,11,15 * * 1-5"
// Pra só 10h e 14h: "0 10,14 * * 1-5"
```

---

## 5. Perfil WhatsApp

```bash
AGENT_NAME="SeuBot | SuaEmpresa" \
AGENT_STATUS="Atendimento 9h-19h ⚡ | seusite.com" \
AGENT_AVATAR_URL="https://seucdn.com/avatar.png" \
bash scripts/whatsapp-profile-setup.sh
```

---

## 6. Idioma/Locale

Atualmente o prompt e workflows são **PT-BR only**. Pra internacionalizar:

1. Traduza `prompts/ana-template.md`
2. Ajuste mensagens no `Build First Contact` do Dispatcher (hardcoded em PT-BR)
3. Ajuste `delayTxt` no Wake-up Queue ("ontem à noite" → "last night")
4. Trocar timezone em docker-compose.yml (`TZ`, `GENERIC_TIMEZONE`)

---

## 7. Multi-tenant (vários agents na mesma VPS)

É possível, mas requer:

1. Múltiplas instâncias no Evolution (1 por agent)
2. Múltiplos `agent_id` em `agent_prompts` (ex: `ana-sondar`, `carlos-outrobiz`)
3. Workflows n8n separados ou parametrizados por `agent_id`
4. Chips WhatsApp diferentes (1 por agent, obrigatoriamente)

Mais fácil: **1 VPS por agent**. Contabo custa €5/mês, é barato.
