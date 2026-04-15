# Arquitetura

## Containers na VPS

| Serviço | Imagem | Porta local | Função |
|---------|--------|-------------|--------|
| postgres | postgres:16-alpine | 127.0.0.1:5432 | DB do Evolution (dados WA) |
| redis | redis:7-alpine | 127.0.0.1:6379 | Cache + presence |
| evolution | evoapicloud/evolution-api:v2.3.7 | 127.0.0.1:8080 | Gateway WhatsApp |
| n8n | docker.n8n.io/n8nio/n8n:latest | 127.0.0.1:5678 | Orquestrador |

**Tudo em localhost.** Acesso via SSH tunnel:
```bash
ssh -L 5678:127.0.0.1:5678 -L 8080:127.0.0.1:8080 root@sua-vps
```

## Fluxo de mensagem inbound

```
1. Cliente manda msg no WhatsApp
2. EvolutionAPI recebe → dispara webhook → n8n (Handler Inbound)
3. Handler extrai: phone, text, pushName, messageId
4. Business Hours Check → 8-18h seg-sex?
   ├─ NÃO → Enfileira em opensquad_outbound_queue (scheduled_for=próximo dia útil 9h)
   └─ SIM ↓
5. Log inbound via webhook sync-message (backend persiste em opensquad_messages)
6. Prefetch paralelo:
   - Get Active Prompt (agent_prompts do Supabase)
   - Get Conversation History (últimas 20 msgs)
   - Get Lead Context (lead_context + conversation_stage)
   - Get Plans (tool: /api/agents/ana/tools/get-plans)
   - Check Account (tool: /api/agents/ana/tools/check-lead-account)
7. Build Prompt + History: monta prompt com PERFIL + STATUS + PLANOS + HISTÓRICO + NOVA MSG
8. Gemini 2.0 Flash via API direta (AI Studio)
9. Extract AI Response:
   - Parse marker <<ESCALAR:motivo:resumo>> se presente
   - Sanitiza output (remove blocos de código, tool_code, tags XML)
   - Calcula typing delay (60ms/char + 800ms, clamp 2-12s)
10. Send Typing Presence → Wait → Send WhatsApp Message
11. Log outbound via sync-message
12. IF should_escalate:
     → Open Ticket (cria support_ticket + notifica Telegram)
13. Update Lead Context (2ª chamada Gemini silenciosa, fire-forget)
```

## Fluxo Dispatcher (prospecção)

```
Schedule 9h/11h/15h seg-sex → Fetch Leads (status=discovered) → Split → Build First Contact → Send MSG 1 → Wait 5-11s → Send MSG 2 → Log → Update status=contacted → Wait 30-60s → next
```

## Fluxo Wake-up Queue

```
Schedule 9h seg-sex → Fetch Due Queue (scheduled_for<=now, status=pending) → Split → Mark processing → Get History + Context + Plans → Build Wake-up Prompt (com delayTxt: "ontem à noite" / "ontem" / "no fim de semana") → Gemini → Send → Log → Mark sent → Wait 20-40s
```

## Tabelas principais

| Tabela | Função |
|--------|--------|
| opensquad_leads | Lead CRM (phone, company, stage, context JSONB) |
| opensquad_messages | Histórico completo de msgs (direction, content) |
| opensquad_events | Audit trail (ticket_opened, reply_received, ...) |
| opensquad_context_updates | Histórico de mudanças do lead_context |
| opensquad_outbound_queue | Fila dispatcher + wake-up |
| agent_prompts | Versionamento do prompt (edição viva pelo admin) |
| support_tickets | Tickets de escalação humana |
| subscription_plans | Fonte de verdade dos planos (tool get-plans lê daqui) |

## Escalação pra humano

A Ana escreve o marker `<<ESCALAR:motivo:resumo>>` no FINAL da resposta. O Handler:
1. Parse do marker no Extract AI Response
2. Remove marker do texto antes de enviar pro cliente
3. Se marker presente → POST /api/webhooks/opensquad/open-ticket
4. Endpoint cria support_ticket com opensquad_lead_id e notifica Telegram

**Motivos suportados:**
- `hot_interest` — "quero testar agora"
- `trial_request` — pediu trial estendido
- `negotiation` — discussão de preço
- `technical_question` — dúvida que Ana não sabe
- `complaint` — reclamação

## Memória (lead_context JSONB)

```json
{
  "persona_fit": 85,
  "pain_points": ["demora 3h no Word", "falta auditor normativo"],
  "objections": ["preço alto"],
  "signals": {
    "uses_word": true,
    "monthly_reports": 15,
    "team_size": 5,
    "segment": "engenharia_civil"
  },
  "next_action": "mandar link de trial",
  "last_summary": "Engenheiro em SP, 15 relat/mês, usa Word. Interessou.",
  "updated_at": "2026-04-15T20:30:00Z"
}
```

Atualizado pela **2ª chamada Gemini silenciosa** (endpoint `/api/webhooks/opensquad/update-context`) após cada resposta do agente.
