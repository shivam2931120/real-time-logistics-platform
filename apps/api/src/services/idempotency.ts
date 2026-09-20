import { dbEnabled, pool } from "../db/client.js";
import { asUuid, demoOrganizationId, demoOrganizationUuid } from "../db/persistence.js";

export type IdempotencyResult = { status: number; body: unknown };

const memory = new Map<string, { result: IdempotencyResult; expiresAt: number }>();
const locks = new Map<string, Promise<void>>();
const ttlMs = 24 * 60 * 60 * 1000;
const organizationUuid = (value: string) =>
  value === demoOrganizationId ? demoOrganizationUuid : asUuid(value);
const scope = (organizationId: string, key: string, route: string) =>
  `${organizationId}:${route}:${key}`;

export async function getIdempotencyResult(
  organizationId: string,
  key: string,
  route: string,
): Promise<IdempotencyResult | undefined> {
  const memoryKey = scope(organizationId, key, route);
  const cached = memory.get(memoryKey);
  if (cached) {
    if (cached.expiresAt > Date.now()) return cached.result;
    memory.delete(memoryKey);
  }
  if (!dbEnabled || !pool) return undefined;
  try {
    const result = await pool.query<{ response_status: number; response_body: unknown }>(
      `SELECT response_status,response_body FROM idempotency_records
       WHERE organization_id=$1 AND key=$2 AND route=$3 AND created_at >= now() - interval '24 hours'`,
      [organizationUuid(organizationId), key, route],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const value = { status: Number(row.response_status), body: row.response_body };
    memory.set(memoryKey, { result: value, expiresAt: Date.now() + ttlMs });
    return value;
  } catch {
    // Keep the API usable before the additive migration has been applied.
    return undefined;
  }
}

export async function rememberIdempotencyResult(
  organizationId: string,
  key: string,
  route: string,
  result: IdempotencyResult,
) {
  const memoryKey = scope(organizationId, key, route);
  memory.set(memoryKey, { result, expiresAt: Date.now() + ttlMs });
  if (!dbEnabled || !pool) return;
  try {
    await pool.query(
      `INSERT INTO idempotency_records(organization_id,key,route,response_status,response_body)
       VALUES($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT(organization_id,key,route) DO NOTHING`,
      [organizationUuid(organizationId), key, route, result.status, JSON.stringify(result.body)],
    );
  } catch {
    // The in-memory result still protects retries in this process.
  }
}

export async function acquireIdempotencyLock(
  organizationId: string,
  key: string,
  route: string,
) {
  const memoryKey = scope(organizationId, key, route);
  const previous = locks.get(memoryKey) || Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const chain = previous.then(() => current);
  locks.set(memoryKey, chain);
  await previous;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseCurrent();
    if (locks.get(memoryKey) === chain) locks.delete(memoryKey);
  };
}
