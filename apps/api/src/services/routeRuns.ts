import { randomUUID } from "node:crypto";
import type { RoutePlan, RouteRun, RouteRunStatus } from "@routepulse/shared";
import { pool } from "../db/client.js";
import {
  asUuid,
  demoOrganizationId,
  demoOrganizationUuid,
} from "../db/persistence.js";
import { drivers, orders, users } from "../domain/store.js";

const routeRuns = new Map<string, RouteRun>();
const organizationUuid = (value: string) =>
  value === demoOrganizationId ? demoOrganizationUuid : asUuid(value);
const organizationDomainId = (value: string) =>
  value === demoOrganizationUuid ? demoOrganizationId : value;
const domainId = (value: string, candidates: Array<{ id: string }>) =>
  candidates.find((candidate) => asUuid(candidate.id) === value)?.id || value;

export async function initializeRouteRuns() {
  if (!pool) return;
  try {
    const result = await pool.query(
      `SELECT id::text,organization_id::text,driver_id::text,order_ids,stops,
              distance_km,duration_minutes,status,version,created_by::text,
              created_at,updated_at,published_at,completed_at
       FROM route_runs ORDER BY created_at DESC`,
    );
    for (const row of result.rows) {
      routeRuns.set(row.id, {
        id: row.id,
        organizationId: organizationDomainId(row.organization_id),
        driverId: domainId(row.driver_id, drivers),
        orderIds: (Array.isArray(row.order_ids) ? row.order_ids : []).map((id: string) =>
          domainId(id, orders),
        ),
        stops: Array.isArray(row.stops) ? row.stops : [],
        distanceKm: Number(row.distance_km),
        durationMinutes: Number(row.duration_minutes),
        status: row.status,
        version: Number(row.version),
        createdBy: domainId(row.created_by, users),
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
        publishedAt: row.published_at ? new Date(row.published_at).toISOString() : undefined,
        completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : undefined,
      });
    }
  } catch {
    // A release can start before the baseline migration has run. The API
    // remains usable in memory and the next migration loads durable runs.
  }
}

export async function createRouteRun(input: {
  organizationId: string;
  createdBy: string;
  driverId: string;
  orderIds: string[];
  plan: RoutePlan;
}) {
  const now = new Date().toISOString();
  const run: RouteRun = {
    id: randomUUID(),
    organizationId: input.organizationId,
    driverId: input.driverId,
    orderIds: [...input.orderIds],
    stops: input.plan.stops,
    distanceKm: input.plan.distanceKm,
    durationMinutes: input.plan.durationMinutes,
    status: "draft",
    version: 1,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  routeRuns.set(run.id, run);
  if (pool) {
    await pool.query(
      `INSERT INTO route_runs(id,organization_id,driver_id,order_ids,stops,distance_km,duration_minutes,status,version,created_by,created_at,updated_at)
       VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,$11)`,
      [
        run.id,
        organizationUuid(run.organizationId),
        asUuid(run.driverId),
        JSON.stringify(run.orderIds.map(asUuid)),
        JSON.stringify(run.stops),
        run.distanceKm,
        run.durationMinutes,
        run.status,
        run.version,
        asUuid(run.createdBy),
        now,
      ],
    );
  }
  return run;
}

export async function listRouteRuns(organizationId: string, driverId?: string) {
  if (pool) {
    try {
      const result = await pool.query(
        `SELECT id::text,organization_id::text,driver_id::text,order_ids,stops,
                distance_km,duration_minutes,status,version,created_by::text,
                created_at,updated_at,published_at,completed_at
         FROM route_runs WHERE organization_id=$1 ${driverId ? "AND driver_id=$2" : ""}
         ORDER BY created_at DESC`,
        driverId ? [organizationUuid(organizationId), asUuid(driverId)] : [organizationUuid(organizationId)],
      );
      return result.rows.map((row) => ({
        id: row.id,
        organizationId: organizationDomainId(row.organization_id),
        driverId: domainId(row.driver_id, drivers),
        orderIds: (Array.isArray(row.order_ids) ? row.order_ids : []).map((id: string) => domainId(id, orders)),
        stops: Array.isArray(row.stops) ? row.stops : [],
        distanceKm: Number(row.distance_km),
        durationMinutes: Number(row.duration_minutes),
        status: row.status as RouteRunStatus,
        version: Number(row.version),
        createdBy: domainId(row.created_by, users),
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
        publishedAt: row.published_at ? new Date(row.published_at).toISOString() : undefined,
        completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : undefined,
      } satisfies RouteRun));
    } catch {
      // Fall through to the process cache while a migration is in flight.
    }
  }
  return [...routeRuns.values()]
    .filter((run) => run.organizationId === organizationId && (!driverId || run.driverId === driverId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getRouteRun(organizationId: string, id: string) {
  const run = routeRuns.get(id);
  return run?.organizationId === organizationId ? run : undefined;
}

export async function updateRouteRunStatus(
  run: RouteRun,
  status: RouteRunStatus,
  expectedVersion?: number,
) {
  if (expectedVersion !== undefined && run.version !== expectedVersion)
    throw Object.assign(new Error("Route run has changed; reload before updating"), { status: 409 });
  const now = new Date().toISOString();
  run.status = status;
  run.version += 1;
  run.updatedAt = now;
  if (status === "published") run.publishedAt = run.publishedAt || now;
  if (status === "completed") run.completedAt = now;
  if (pool) {
    await pool.query(
      `UPDATE route_runs SET status=$1,version=$2,updated_at=$3,published_at=$4,completed_at=$5 WHERE id=$6 AND organization_id=$7`,
      [status, run.version, now, run.publishedAt || null, run.completedAt || null, run.id, organizationUuid(run.organizationId)],
    );
  }
  return run;
}
