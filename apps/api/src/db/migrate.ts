import 'dotenv/config';
import { pool } from './client.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

if (!pool) throw new Error('DATABASE_URL is required. Copy .env.example to .env first.');
const sql = await readFile(fileURLToPath(new URL('../../../../docs/schema.sql', import.meta.url)), 'utf8');
const client = await pool.connect();
try {
  await client.query('CREATE EXTENSION IF NOT EXISTS citext');
  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const existing = await client.query<{ exists: boolean }>(`SELECT to_regclass('public.organizations') IS NOT NULL AS exists`);
  if (!existing.rows[0]?.exists) await client.query(sql);
  await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS clerk_organization_id text`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_user_id text`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_clerk_user_id_idx ON users(clerk_user_id) WHERE clerk_user_id IS NOT NULL`);
  await client.query(`INSERT INTO schema_migrations(version) VALUES('001_baseline') ON CONFLICT DO NOTHING`);
  console.info(existing.rows[0]?.exists ? 'RoutePulse database schema is current' : 'RoutePulse database schema applied');
} finally { client.release(); await pool.end(); }
