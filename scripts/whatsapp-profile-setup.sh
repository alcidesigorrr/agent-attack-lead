#!/usr/bin/env bash
# ============================================================================
# whatsapp-profile-setup.sh — Configura perfil do WhatsApp do agent
# ============================================================================
# Configura: nome, status (bio), privacidade e foto de perfil.
#
# Uso:
#   AGENT_NAME="Ana | MinhaEmpresa" \
#   AGENT_STATUS="Atendimento 8h-18h 🏗️ | site.com.br" \
#   AGENT_AVATAR_URL="https://ui-avatars.com/api/?name=Ana&background=f59e0b&color=fff&size=512" \
#   bash scripts/whatsapp-profile-setup.sh
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
source .env

BASE="${EVOLUTION_URL:-http://localhost:8080}"
INST="${AGENT_ID:-agent}"
KEY="$EVO_API_KEY"

NAME="${AGENT_NAME:-Ana}"
STATUS="${AGENT_STATUS:-Atendimento comercial}"
AVATAR_URL="${AGENT_AVATAR_URL:-https://ui-avatars.com/api/?name=${NAME// /+}&background=f59e0b&color=fff&size=512&bold=true}"

echo "==> Name..."
curl -s -X POST "$BASE/chat/updateProfileName/$INST" \
  -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d "{\"name\":\"$NAME\"}" | head -c 200; echo

echo "==> Status..."
curl -s -X POST "$BASE/chat/updateProfileStatus/$INST" \
  -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d "{\"status\":\"$STATUS\"}" | head -c 200; echo

echo "==> Privacy (tudo público)..."
curl -s -X POST "$BASE/chat/updatePrivacySettings/$INST" \
  -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d '{
    "readreceipts": "all",
    "profile": "all",
    "status": "all",
    "online": "all",
    "last": "all",
    "groupadd": "all"
  }' | head -c 200; echo

echo "==> Profile picture..."
TMP_PNG=$(mktemp --suffix=.png)
curl -s "$AVATAR_URL" -o "$TMP_PNG"
B64=$(base64 -w 0 "$TMP_PNG" 2>/dev/null || base64 -i "$TMP_PNG" | tr -d '\n')
curl -s -X POST "$BASE/chat/updateProfilePicture/$INST" \
  -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d "{\"picture\":\"$B64\"}" | head -c 200; echo
rm -f "$TMP_PNG"

echo ""
echo "✅ Perfil configurado"
echo ""
echo "⚠️  Horário comercial do WhatsApp Business: precisa ser configurado MANUALMENTE"
echo "   no app: Menu → Ferramentas comerciais → Horário comercial"
echo "   (Evolution API v2.3.7 não expõe update desse campo)"
