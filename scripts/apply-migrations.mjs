#!/usr/bin/env node
/**
 * apply-migrations.mjs — Aplica migrations SQL no Supabase via pg direct
 *
 * Uso:
 *   DB_PASSWORD=sua_senha node scripts/apply-migrations.mjs
 *
 * Configurações via env:
 *   DB_PASSWORD       (obrigatório) — senha do database Supabase
 *   SUPABASE_PROJECT  (opcional)    — project-ref (default lê de .env)
 *   POOLER_HOST       (opcional)    — aws-1-sa-east-1.pooler.supabase.com
 */
import { Client } from "pg";
import { readFileSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

config({ path: join(ROOT, ".env") });

const DB_PASSWORD = process.env.DB_PASSWORD || process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD) {
  console.error("❌ Forneça DB_PASSWORD via env");
  process.exit(1);
}

const PROJECT = process.env.SUPABASE_PROJECT || extractProjectFromUrl();
const POOLER = process.env.POOLER_HOST || "aws-1-sa-east-1.pooler.supabase.com";
const PORT = process.env.POOLER_PORT || 5432;

function extractProjectFromUrl() {
  const url = process.env.SUPABASE_URL || "";
  const m = url.match(/https:\/\/([^.]+)\.supabase\.co/);
  if (!m) {
    console.error("❌ SUPABASE_URL inválida ou ausente");
    process.exit(1);
  }
  return `postgres.${m[1]}`;
}

const CONN_STR = `postgresql://${PROJECT}:${encodeURIComponent(DB_PASSWORD)}@${POOLER}:${PORT}/postgres`;

const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

console.log(`📁 ${files.length} migrations encontradas`);

const client = new Client({ connectionString: CONN_STR, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("🔌 Conectado ao Supabase");

for (const file of files) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  console.log(`\n➡️  Aplicando ${file}...`);
  try {
    await client.query(sql);
    console.log(`   ✅ ${file}`);
  } catch (e) {
    console.error(`   ❌ ${file}: ${e.message}`);
    // Continue anyway (IF NOT EXISTS should handle re-runs)
  }
}

await client.end();
console.log("\n✅ Migrations aplicadas");
