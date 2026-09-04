import { Pool } from 'pg';

export const databaseUrl = process.env.DATABASE_URL || '';
export const dbEnabled = Boolean(databaseUrl);
export const pool = dbEnabled ? new Pool({ connectionString: databaseUrl, max: 10, connectionTimeoutMillis: 3000 }) : undefined;

export async function closeDb() { await pool?.end(); }
