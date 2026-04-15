#!/usr/bin/env bash
# ============================================================================
# setup-vps.sh — Prepara uma VPS Ubuntu 22.04+ para rodar o agent stack
# ============================================================================
# Roda como root na VPS (uma vez só).
# ----------------------------------------------------------------------------
set -euo pipefail

echo "==> Atualizando sistema..."
apt-get update -qq
apt-get upgrade -y -qq

echo "==> Instalando dependências..."
apt-get install -y -qq \
  curl \
  ca-certificates \
  ufw \
  fail2ban \
  sqlite3 \
  python3

echo "==> Configurando firewall (SSH only)..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw --force enable

echo "==> Instalando Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Instalando docker-compose-plugin (se necessário)..."
apt-get install -y -qq docker-compose-plugin || true

echo "==> Verificando Docker..."
docker version --format '{{.Server.Version}}' || { echo "Docker falhou"; exit 1; }
docker compose version || { echo "docker compose plugin falhou"; exit 1; }

echo "==> Ajustando fail2ban (default SSH policy)..."
systemctl enable --now fail2ban

echo ""
echo "✅ VPS pronta. Próximo passo:"
echo "   1. Edite .env com seus secrets"
echo "   2. Rode: bash infrastructure/install.sh"
