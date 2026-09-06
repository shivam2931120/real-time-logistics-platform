import "dotenv/config";
import { pool } from "./client.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

if (!pool)
  throw new Error("DATABASE_URL is required. Copy .env.example to .env first.");
const sql = await readFile(
  fileURLToPath(new URL("../../../../docs/schema.sql", import.meta.url)),
  "utf8",
);
const client = await pool.connect();
try {
  await client.query("CREATE EXTENSION IF NOT EXISTS citext");
  await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  // Apply the baseline on every run. The schema statements are idempotent, so
  // this also repairs a database that was only partially initialized.
  await client.query(sql);
  await client.query(
    `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS clerk_organization_id text`,
  );
  await client.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_user_id text`,
  );
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS users_clerk_user_id_idx ON users(clerk_user_id) WHERE clerk_user_id IS NOT NULL`,
  );
  await client.query(
    `INSERT INTO schema_migrations(version) VALUES('001_baseline'),('002_free_operations'),('003_self_service_reporting_support') ON CONFLICT DO NOTHING`,
  );
  console.info("RoutePulse database schema is current");
} finally {
  client.release();
  await pool.end();
}
