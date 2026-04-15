#!/usr/bin/env node
/**
 * push-prompt.mjs — Sobe um prompt novo pro Supabase (agent_prompts)
 *
 * Uso:
 *   DB_PASSWORD=xxx AGENT_ID=ana-seubiz node scripts/push-prompt.mjs prompts/ana-template.md
 *
 * Cada vez que roda: cria nova versão e marca como ativa (trigger garante single active).
 */
import { Client } from "pg";
import { readFileSync } from "fs";
import { config } from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

const DB_PASSWORD = process.env.DB_PASSWORD || process.env.SUPABASE_DB_PASSWORD;
const AGENT_ID = process.env.AGENT_ID || "ana";
const PROMPT_FILE = process.argv[2];

if (!DB_PASSWORD || !PROMPT_FILE) {
  console.error("Uso: DB_PASSWORD=xxx AGENT_ID=ana node push-prompt.mjs <arquivo.md>");
  process.exit(1);
}

const project = process.env.SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
if (!project) {
  console.error("❌ SUPABASE_URL inválida em .env");
  process.exit(1);
}

const cs = `postgresql://postgres.${project}:${encodeURIComponent(DB_PASSWORD)}@aws-1-sa-east-1.pooler.supabase.com:5432/postgres`;
const client = new Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
await client.connect();

const sql = readFileSync(PROMPT_FILE, "utf8");
const nextVersion = (
  await client.query("SELECT COALESCE(MAX(version),0)+1 AS n FROM agent_prompts WHERE agent_id=$1", [AGENT_ID])
).rows[0].n;

const res = await client.query(
  `INSERT INTO agent_prompts (agent_id, version, label, system_prompt, model_primary, temperature, max_tokens, is_active, published_at, published_by, notes)
   VALUES ($1, $2, $3, $4, 'gemini-2.0-flash', 0.4, 500, TRUE, now(), $5, $6) RETURNING id, version`,
  [AGENT_ID, nextVersion, `v${nextVersion} — auto push`, sql, "push-prompt.mjs", `From ${PROMPT_FILE}`]
);
console.log(`✅ Agent ${AGENT_ID} v${nextVersion} ativo — id ${res.rows[0].id}`);
await client.end();
