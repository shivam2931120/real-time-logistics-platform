import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type {
  IntegrationApiKeySummary,
  IntegrationWebhookSummary,
  Role,
  User,
} from "@routepulse/shared";
import { pool } from "../db/client.js";
import { users } from "../domain/store.js";
import { asUuid, demoOrganizationId, demoOrganizationUuid } from "../db/persistence.js";

type StoredApiKey = IntegrationApiKeySummary & {
  organizationId: string;
  createdBy: string;
  keyHash: string;
};
type StoredWebhook = IntegrationWebhookSummary & {
  organizationId: string;
  createdBy: string;
  secret: string;
};

const apiKeys = new Map<string, StoredApiKey>();
const webhooks = new Map<string, StoredWebhook>();
const hashKey = (value: string) => createHash("sha256").update(value).digest("hex");
const domainOrganizationId = (value: string) =>
  value === demoOrganizationUuid ? demoOrganizationId : value;
const validRole = (value: unknown): Role =>
  ["admin", "dispatcher", "driver", "customer"].includes(String(value))
    ? (value as Role)
    : "customer";

export async function createIntegrationApiKey(input: {
  organizationId: string;
  createdBy: string;
  name: string;
}) {
  const id = randomUUID();
  const value = `rp_live_${randomBytes(24).toString("base64url")}`;
  const keyHash = hashKey(value);
  const prefix = `${value.slice(0, 16)}…`;
  const createdAt = new Date().toISOString();
  if (pool) {
    await pool.query(
      `INSERT INTO integration_api_keys(id,organization_id,name,key_prefix,key_hash,created_by,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        input.organizationId === demoOrganizationId
          ? demoOrganizationUuid
          : asUuid(input.organizationId),
        input.name,
        prefix,
        keyHash,
        asUuid(input.createdBy),
        createdAt,
      ],
    );
  } else {
    apiKeys.set(id, {
      id,
      organizationId: input.organizationId,
      createdBy: input.createdBy,
      name: input.name,
      prefix,
      keyHash,
      createdAt,
    });
  }
  return { id, name: input.name, prefix, key: value, createdAt };
}

export async function listIntegrationApiKeys(
  organizationId: string,
): Promise<IntegrationApiKeySummary[]> {
  if (pool) {
    const result = await pool.query(
      `SELECT id::text,name,key_prefix,created_at,last_used_at,revoked_at
       FROM integration_api_keys WHERE organization_id=$1 ORDER BY created_at DESC`,
      [organizationId === demoOrganizationId ? demoOrganizationUuid : asUuid(organizationId)],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      prefix: row.key_prefix,
      createdAt: new Date(row.created_at).toISOString(),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : undefined,
      revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : undefined,
    }));
  }
  return [...apiKeys.values()]
    .filter((key) => key.organizationId === organizationId)
    .map(({ keyHash: _keyHash, organizationId: _organizationId, createdBy: _createdBy, ...summary }) => summary)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function revokeIntegrationApiKey(organizationId: string, id: string) {
  if (pool) {
    const result = await pool.query(
      `UPDATE integration_api_keys SET revoked_at=COALESCE(revoked_at,now())
       WHERE id=$1 AND organization_id=$2 RETURNING id::text`,
      [id, organizationId === demoOrganizationId ? demoOrganizationUuid : asUuid(organizationId)],
    );
    return Boolean(result.rowCount);
  }
  const key = apiKeys.get(id);
  if (!key || key.organizationId !== organizationId) return false;
  key.revokedAt = new Date().toISOString();
  return true;
}

export async function resolveIntegrationApiKey(raw: string): Promise<User | undefined> {
  if (!raw.startsWith("rp_live_")) return undefined;
  const keyHash = hashKey(raw);
  if (pool) {
    try {
      const result = await pool.query(
        `SELECT k.id::text,k.organization_id::text,k.created_by::text,
                u.id::text AS user_id,u.email,u.name,u.role
         FROM integration_api_keys k
         JOIN users u ON u.id=k.created_by AND u.organization_id=k.organization_id
         WHERE k.key_hash=$1 AND k.revoked_at IS NULL LIMIT 1`,
        [keyHash],
      );
      const row = result.rows[0];
      if (!row) return undefined;
      void pool.query(`UPDATE integration_api_keys SET last_used_at=now() WHERE id=$1`, [row.id]);
      return {
        id: row.user_id,
        organizationId: domainOrganizationId(row.organization_id),
        email: row.email,
        name: row.name,
        role: validRole(row.role),
      };
    } catch {
      return undefined;
    }
  }
  const key = [...apiKeys.values()].find(
    (candidate) => candidate.keyHash === keyHash && !candidate.revokedAt,
  );
  if (!key) return undefined;
  const user = users.find(
    (candidate) => candidate.id === key.createdBy && candidate.organizationId === key.organizationId,
  );
  return user;
}

export async function createIntegrationWebhook(input: {
  organizationId: string;
  createdBy: string;
  url: string;
  events: string[];
}) {
  const id = randomUUID();
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const createdAt = new Date().toISOString();
  if (pool) {
    await pool.query(
      `INSERT INTO integration_webhooks(id,organization_id,url,secret,events,active,created_by,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5::jsonb,true,$6,$7,$7)`,
      [
        id,
        input.organizationId === demoOrganizationId ? demoOrganizationUuid : asUuid(input.organizationId),
        input.url,
        secret,
        JSON.stringify(input.events),
        asUuid(input.createdBy),
        createdAt,
      ],
    );
  } else {
    webhooks.set(id, {
      id,
      organizationId: input.organizationId,
      createdBy: input.createdBy,
      url: input.url,
      secret,
      events: input.events,
      active: true,
      createdAt,
      updatedAt: createdAt,
    });
  }
  return { id, url: input.url, events: input.events, secret, createdAt };
}

export async function listIntegrationWebhooks(
  organizationId: string,
): Promise<IntegrationWebhookSummary[]> {
  if (pool) {
    const result = await pool.query(
      `SELECT id::text,url,events,active,created_at,updated_at
       FROM integration_webhooks WHERE organization_id=$1 ORDER BY created_at DESC`,
      [organizationId === demoOrganizationId ? demoOrganizationUuid : asUuid(organizationId)],
    );
    return result.rows.map((row) => ({
      id: row.id,
      url: row.url,
      events: Array.isArray(row.events) ? row.events : [],
      active: row.active,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }
  return [...webhooks.values()]
    .filter((webhook) => webhook.organizationId === organizationId)
    .map(({ secret: _secret, createdBy: _createdBy, ...summary }) => summary)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function disableIntegrationWebhook(organizationId: string, id: string) {
  if (pool) {
    const result = await pool.query(
      `UPDATE integration_webhooks SET active=false,updated_at=now()
       WHERE id=$1 AND organization_id=$2 RETURNING id::text`,
      [id, organizationId === demoOrganizationId ? demoOrganizationUuid : asUuid(organizationId)],
    );
    return Boolean(result.rowCount);
  }
  const webhook = webhooks.get(id);
  if (!webhook || webhook.organizationId !== organizationId) return false;
  webhook.active = false;
  webhook.updatedAt = new Date().toISOString();
  return true;
}

export async function dispatchIntegrationEvent(
  organizationId: string,
  event: string,
  payload: Record<string, unknown>,
) {
  const targets: Array<{ url: string; secret: string; events: string[] }> = [];
  if (pool) {
    try {
      const result = await pool.query(
        `SELECT url,secret,events FROM integration_webhooks
         WHERE organization_id=$1 AND active=true`,
        [organizationId === demoOrganizationId ? demoOrganizationUuid : asUuid(organizationId)],
      );
      for (const row of result.rows)
        if (Array.isArray(row.events) && (row.events.includes("*") || row.events.includes(event)))
          targets.push({ url: row.url, secret: row.secret, events: row.events });
    } catch {
      return;
    }
  } else {
    for (const webhook of webhooks.values())
      if (
        webhook.organizationId === organizationId &&
        webhook.active &&
        (webhook.events.includes("*") || webhook.events.includes(event))
      )
        targets.push(webhook);
  }
  if (!targets.length) return;
  const body = JSON.stringify({ id: randomUUID(), event, organizationId, occurredAt: new Date().toISOString(), data: payload });
  await Promise.allSettled(
    targets.map(async (target) => {
      const signature = createHmac("sha256", target.secret).update(body).digest("hex");
      await fetch(target.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "RoutePulse-Webhooks/1.0",
          "x-routepulse-event": event,
          "x-routepulse-signature": `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(5_000),
      });
    }),
  );
}
