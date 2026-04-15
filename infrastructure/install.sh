#!/usr/bin/env bash
# ============================================================================
# install.sh — Sobe o stack Docker do agent
# ============================================================================
set -euo pipefail

if [[ ! -f .env ]]; then
  echo "❌ .env não encontrado. Copie .env.example → .env e preencha."
  exit 1
fi

source .env

echo "==> Validando variáveis obrigatórias..."
for var in AGENT_ID EVO_API_KEY POSTGRES_PASSWORD N8N_ENCRYPTION_KEY N8N_ADMIN_PASSWORD GEMINI_API_KEY; do
  if [[ -z "${!var:-}" ]]; then
    echo "❌ $var não definido em .env"
    exit 1
  fi
done

echo "==> Subindo stack (postgres, redis, evolution, n8n)..."
docker compose up -d

echo "==> Aguardando health checks..."
for i in {1..30}; do
  PG_STATE=$(docker compose ps --format '{{.Service}} {{.Health}}' | grep postgres | awk '{print $2}' || true)
  if [[ "$PG_STATE" == "healthy" ]]; then
    echo "✅ postgres healthy"
    break
  fi
  sleep 2
done

echo "==> Status final:"
docker compose ps

echo ""
echo "✅ Stack no ar. Próximos passos:"
echo ""
echo "   1. Aplicar migrations Supabase:"
echo "      DB_PASSWORD=\$SUPABASE_DB_PASSWORD node scripts/apply-migrations.mjs"
echo ""
echo "   2. Push do prompt:"
echo "      DB_PASSWORD=\$SUPABASE_DB_PASSWORD AGENT_ID=\$AGENT_ID node scripts/push-prompt.mjs prompts/ana-template.md"
echo ""
echo "   3. Acessar n8n via SSH tunnel:"
echo "      ssh -L 5678:127.0.0.1:5678 root@sua-vps"
echo "      Abrir http://localhost:5678"
echo ""
echo "   4. Criar instância WhatsApp e escanear QR:"
echo "      curl -X POST http://localhost:8080/instance/create \\"
echo "        -H \"apikey: \$EVO_API_KEY\" \\"
echo "        -d '{\"instanceName\":\"\$AGENT_ID\", \"qrcode\": true}'"
echo ""
echo "   5. Deploy workflows:"
echo "      bash scripts/deploy-workflows.sh"
