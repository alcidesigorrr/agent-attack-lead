#!/usr/bin/env bash
# ============================================================================
# deploy-workflows.sh — Importa os 4 workflows JSON no n8n da VPS
# ============================================================================
# Substitui placeholders ({{ SUPABASE_URL }}, etc) pelos valores do .env
# e insere direto no sqlite do n8n.
#
# Pré-requisito: stack rodando (docker compose up -d)
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
source .env

if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" || -z "${GEMINI_API_KEY:-}" ]]; then
  echo "❌ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e GEMINI_API_KEY precisam estar em .env"
  exit 1
fi

CONTAINER="${AGENT_ID:-agent}-n8n"
VOL_PATH=$(docker volume inspect "${AGENT_ID:-agent-attack}_n8n_data" --format '{{.Mountpoint}}' 2>/dev/null || true)

if [[ -z "$VOL_PATH" ]]; then
  echo "❌ Volume n8n não encontrado. Rode 'bash infrastructure/install.sh' primeiro."
  exit 1
fi

echo "==> Substituindo placeholders nos workflows..."
TMPDIR=$(mktemp -d)
for f in n8n/workflows/*.json; do
  name=$(basename "$f")
  sed \
    -e "s|{{ SUPABASE_URL }}|$SUPABASE_URL|g" \
    -e "s|{{ SUPABASE_SERVICE_ROLE_KEY }}|$SUPABASE_SERVICE_ROLE_KEY|g" \
    -e "s|{{ GEMINI_API_KEY }}|$GEMINI_API_KEY|g" \
    -e "s|{{ BACKEND_BASE_URL }}|${BACKEND_BASE_URL:-http://localhost:3000}|g" \
    -e "s|{{ AGENT_ID }}|${AGENT_ID:-agent}|g" \
    "$f" > "$TMPDIR/$name"
done

echo "==> Parando n8n pra editar sqlite..."
docker stop "$CONTAINER" >/dev/null

echo "==> Importando workflows no sqlite..."
python3 << PYEOF
import sqlite3, json, uuid, time, os

db = "$VOL_PATH/database.sqlite"
c = sqlite3.connect(db)

WORKFLOWS = [
    ("01-handler-inbound.json", "Agent — Handler Inbound"),
    ("02-dispatcher-outbound.json", "Agent — Dispatcher Outbound"),
    ("03-wakeup-queue.json", "Agent — Wake-up Queue"),
    # ("04-followup.json", "Agent — Follow-up"),  # placeholder
]

# Get or create default project
row = c.execute("SELECT id FROM project WHERE type='personal' LIMIT 1").fetchone()
if not row:
    print("❌ Nenhum project encontrado. Abra n8n na UI e faça login primeiro.")
    exit(1)
project_id = row[0]
print(f"Project: {project_id}")

for fname, expected_name in WORKFLOWS:
    path = f"$TMPDIR/{fname}"
    if not os.path.exists(path):
        print(f"  ⚠️  {fname} não encontrado, pulando")
        continue
    with open(path) as f:
        wf = json.load(f)

    name = wf.get('name', expected_name)
    # Skip if no nodes
    if not wf.get('nodes'):
        print(f"  ⚠️  {fname} vazio, pulando")
        continue

    existing = c.execute("SELECT id FROM workflow_entity WHERE name=?", (name,)).fetchone()
    if existing:
        wf_id = existing[0]
        c.execute("""UPDATE workflow_entity SET nodes=?, connections=?, settings=?, active=1, updatedAt=? WHERE id=?""",
                  (json.dumps(wf['nodes'], ensure_ascii=False),
                   json.dumps(wf['connections'], ensure_ascii=False),
                   json.dumps(wf.get('settings', {})),
                   time.strftime('%Y-%m-%d %H:%M:%S'), wf_id))
        print(f"  🔄 Atualizado: {name}")
    else:
        wf_id = 'WF_' + uuid.uuid4().hex[:12]
        version_id = str(uuid.uuid4())
        c.execute("""INSERT INTO workflow_entity
                     (id, name, nodes, connections, settings, active, isArchived, createdAt, updatedAt, triggerCount, versionId)
                     VALUES (?, ?, ?, ?, ?, 1, 0, datetime('now'), datetime('now'), 1, ?)""",
                  (wf_id, name,
                   json.dumps(wf['nodes'], ensure_ascii=False),
                   json.dumps(wf['connections'], ensure_ascii=False),
                   json.dumps(wf.get('settings', {})),
                   version_id))
        # Shared workflow entry
        c.execute("INSERT INTO shared_workflow (workflowId, projectId, role) VALUES (?, ?, 'workflow:owner')",
                  (wf_id, project_id))
        # Workflow history entry (pra ativar)
        c.execute("""INSERT INTO workflow_history (versionId, workflowId, authors, nodes, connections, name, autosaved)
                     VALUES (?, ?, 'deploy-script', ?, ?, ?, 0)""",
                  (version_id, wf_id,
                   json.dumps(wf['nodes'], ensure_ascii=False),
                   json.dumps(wf['connections'], ensure_ascii=False),
                   name))
        c.execute("UPDATE workflow_entity SET activeVersionId=? WHERE id=?", (version_id, wf_id))
        print(f"  ✅ Criado: {name} (id {wf_id})")

c.commit()
c.close()
PYEOF

chown -R 1000:1000 "$VOL_PATH"
chmod 644 "$VOL_PATH/database.sqlite"
rm -f "$VOL_PATH/database.sqlite-shm" "$VOL_PATH/database.sqlite-wal"

echo "==> Subindo n8n de volta..."
docker start "$CONTAINER" >/dev/null
sleep 10

docker logs --tail 10 "$CONTAINER" 2>&1 | tail -5

rm -rf "$TMPDIR"
echo ""
echo "✅ Workflows deployados"
echo "⚠️  Próximo: crie as credentials do Evolution e Google Gemini no n8n (via UI) e linke com os nodes manualmente"
echo "   OU rode: bash scripts/link-credentials.sh (se você já tem IDs de credentials setados)"
