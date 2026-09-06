import { Pool } from "pg";

export const databaseUrl = process.env.DATABASE_URL || "";
export const dbEnabled = Boolean(databaseUrl);
export const pool = dbEnabled
  ? new Pool({
      connectionString: databaseUrl,
      max: Number(process.env.DB_POOL_MAX || 5),
      connectionTimeoutMillis: Number(
        process.env.DB_CONNECTION_TIMEOUT_MS || 15_000,
      ),
      idleTimeoutMillis: 30_000,
    })
  : undefined;

export async function closeDb() {
  await pool?.end();
}
