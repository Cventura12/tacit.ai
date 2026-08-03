/**
 * One-off migration runner for the cloud Supabase Postgres instance.
 *
 * Prerequisites:
 *   npm install --save-dev pg @types/pg
 *
 * Add ONE env var to .env.local — the direct Postgres connection string:
 *   CLOUD_SUPABASE_DB_URL=postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres
 *
 * Get it from: Supabase Dashboard → Project Settings → Database →
 *   Connection string → URI  (use "Direct connection", not the pooler)
 *
 * Run:
 *   npx tsx scripts/migrate-cloud.ts
 */

import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import pg from "pg";

const { Client } = pg;

// ── Load .env.local ──────────────────────────────────────────────────────────

function loadEnvLocal(): Record<string, string> {
  const envPath = resolve(process.cwd(), ".env.local");
  let raw: string;
  try {
    raw = readFileSync(envPath, "utf-8");
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes (single or double)
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const env = loadEnvLocal();
// Env vars already set in the process take precedence over .env.local
for (const [k, v] of Object.entries(env)) {
  if (!process.env[k]) process.env[k] = v;
}

// ── Config ───────────────────────────────────────────────────────────────────

const DB_URL = process.env.CLOUD_SUPABASE_DB_URL;

if (!DB_URL) {
  console.error(`
ERROR: CLOUD_SUPABASE_DB_URL is not set.

Add it to .env.local:
  CLOUD_SUPABASE_DB_URL=postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres

Get the connection string from:
  Supabase Dashboard → Project Settings → Database → Connection string → URI
  (choose "Direct connection", not the pooler)
`);
  process.exit(1);
}

const MIGRATION_DIR = resolve(process.cwd(), "supabase");

const MIGRATIONS = [
  "schema.sql",
  "migrations.sql",
  "migrations-02.sql",
  "migrations-03.sql",
  "migrations-04-documents.sql",
  "migrations-05-runs.sql",
  "migrations-06-search-score.sql",
  "migrations-07-ocr.sql",
  "migrations-08-fts-fallback.sql",
  "migrations-09-t002-instrumentation.sql",
  "migrations-10-gmail-body-provenance.sql",
  "migrations-11-t002-body-completeness-boundary.sql",
  "migrations-12-pending-proposals-reply-required.sql",
];

// ── Run ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nConnecting to cloud Postgres…`);
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

  await client.connect();
  console.log("Connected.\n");

  let failed = false;

  for (const filename of MIGRATIONS) {
    const filePath = join(MIGRATION_DIR, filename);
    let sql: string;
    try {
      sql = readFileSync(filePath, "utf-8");
    } catch {
      console.error(`  ✗  ${filename}  —  file not found at ${filePath}`);
      failed = true;
      break;
    }

    process.stdout.write(`  ›  ${filename} … `);
    try {
      await client.query(sql);
      console.log("✓");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log("✗");
      console.error(`\n     Error in ${filename}:\n     ${msg}\n`);
      failed = true;
      break;
    }
  }

  await client.end();

  if (failed) {
    console.error("\nMigration run FAILED — see error above.\n");
    process.exit(1);
  } else {
    console.log(`\nAll ${MIGRATIONS.length} migrations applied successfully.\n`);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
