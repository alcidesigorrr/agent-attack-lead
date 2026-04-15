# Humanização (anti-detecção)

## Por que importa

WhatsApp baneia número novo se detectar padrão de bot. Volume, velocidade, estilo de texto e falta de presence estão entre os sinais principais.

Este projeto já tem **7 camadas de defesa** embutidas:

## 1. Typing presence proporcional

Antes de enviar, manda `presence=composing` pro número. Cliente vê "digitando…". Duração:

```
delay_ms = clamp(text_length * 60 + 800, 2000, 12000)
```

Texto de 50 chars → 3.8s digitando. Texto de 200 chars → 12s (max).

Implementação: nós `Send Typing Presence` + `Wait Typing Delay` no Handler Inbound.

## 2. Delay entre leads no Dispatcher

30-60 segundos aleatório entre cada lead na prospecção.

```javascript
// Wait Between Leads node
amount: Math.floor(Math.random() * 30) + 30
```

Nunca 2 leads seguidos no mesmo segundo — isso grita bot.

## 3. Delay entre MSG 1 e MSG 2 (primeiro contato)

5-11 segundos. Dá impressão de pessoa escrevendo várias msgs.

```javascript
delay_between_ms: Math.floor(Math.random() * 6000) + 5000
```

## 4. Variações de saudação

Cada lead recebe UMA das 3 variantes da MSG 1 e UMA das 3 da MSG 2, sorteadas. Nunca o mesmo texto pra 2 leads.

```javascript
const variants = [
  `Oi${name ? ', ' + name : ''}! Tudo bem?`,
  `Olá${name ? ' ' + name : ''}! Tudo bem?`,
  `Oi! Tudo bem por aí?`
];
const msg1 = variants[Math.floor(Math.random() * variants.length)];
```

## 5. Respeito estrito ao horário comercial

**Só** responde seg-sex 8h-18h (Brasília). Fora disso: enfileira pro próximo dia útil 9h.

Guard implementado em 3 lugares:
- Handler Inbound (Business Hours Check node)
- Dispatcher (Business Hours Guard)
- Wake-up Queue (schedule cron `0 9 * * 1-5`)

## 6. Estilo de texto adulto B2B

O prompt da Ana bane:
- Travessão (`—`) — grita IA
- Gírias de adolescente ("top", "daora", "bora", "mano")
- Frases-clichê de IA ("Como posso te ajudar hoje?", "À sua disposição")
- Excesso de emoji (max 1 por msg)
- Markdown pesado (##, **, listas longas)
- Blocos de código
- Tags XML (`<final>`, `<response>`)

## 7. Não envia 2 msgs iguais pro mesmo lead

Antes de enviar primeira msg, checa `messages_sent_count == 0`. Se já tem mensagem enviada, é follow-up, não first_contact.

---

## Período de aquecimento (CRÍTICO)

**Chip novo não sai enviando 100 msgs no dia 1.** Risco altíssimo de ban.

### Semana 1
- Só responde inbound (não manda outbound)
- 0-5 msgs por dia
- Adiciona 20-30 contatos no celular (só pros contatos de pessoas reais, não leads)
- Manda 5-10 msgs pros contatos adicionados

### Semana 2
- Começa Dispatcher com limite de 5 leads/dia
- Adiciona 20-30 contatos novos
- Continua respondendo inbound normalmente

### Semana 3
- Dispatcher com 10 leads/dia
- Se a taxa de resposta tá boa (>20%) e sem warnings, escala

### Semana 4+
- Operação normal (15 leads/dia no Dispatcher padrão)

**Sinais de ban iminente:**
- Cliente reclama que msgs não chegam
- QR code desconecta do nada
- Evolution logs mostram `connection.update: connecting` constante
- Taxa de resposta cai drasticamente

Se acontecer: para TUDO 72h, depois reescaneia QR.

---

## Monitoramento

Queries úteis no Supabase pra observar:

```sql
-- Taxa de resposta últimos 7 dias
SELECT
  COUNT(DISTINCT CASE WHEN messages_received_count > 0 THEN id END) AS responderam,
  COUNT(*) AS total,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN messages_received_count > 0 THEN id END) / COUNT(*), 1) AS taxa_pct
FROM opensquad_leads
WHERE first_contact_at >= NOW() - INTERVAL '7 days';

-- Leads por stage
SELECT conversation_stage, COUNT(*)
FROM opensquad_leads
GROUP BY conversation_stage ORDER BY 2 DESC;

-- Tickets quentes pendentes
SELECT * FROM support_tickets
WHERE status = 'open' AND urgency IN ('high', 'critical')
ORDER BY created_at DESC;
```
