import type { Coordinate, OperationalAlert, Order } from "@routepulse/shared";
import { drivers, store, users } from "../domain/store.js";
import { listRouteRuns } from "./routeRuns.js";
import { haversineKm } from "./optimizer.js";

const activeOrderStatuses = new Set(["assigned", "picked_up", "in_transit"]);

const pointToSegmentKm = (point: Coordinate, start: Coordinate, end: Coordinate) => {
  const scale = Math.cos(((start.lat + end.lat) / 2) * Math.PI / 180);
  const px = point.lng * scale;
  const py = point.lat;
  const ax = start.lng * scale;
  const ay = start.lat;
  const bx = end.lng * scale;
  const by = end.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const denominator = dx * dx + dy * dy;
  const t = denominator ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denominator)) : 0;
  return haversineKm(point, { lat: ay + (by - ay) * t, lng: (ax + (bx - ax) * t) / (scale || 1) });
};

const routeDistanceKm = (point: Coordinate, stops: Coordinate[]) => {
  if (!stops.length) return 0;
  if (stops.length === 1) return haversineKm(point, stops[0]!);
  return Math.min(...stops.slice(1).map((stop, index) => pointToSegmentKm(point, stops[index]!, stop)));
};

const round = (value: number) => Math.round(value * 10) / 10;

export async function operationalAlerts(
  organizationId: string,
  options: { staleMinutes?: number; dwellMinutes?: number; deviationKm?: number } = {},
): Promise<OperationalAlert[]> {
  const staleMinutes = Math.min(120, Math.max(2, options.staleMinutes ?? 10));
  const dwellMinutes = Math.min(240, Math.max(5, options.dwellMinutes ?? 20));
  const deviationKm = Math.min(50, Math.max(0.5, options.deviationKm ?? 3));
  const now = Date.now();
  const tenantOrders = store.listOrders(organizationId);
  const tenantDrivers = drivers.filter((driver) =>
    users.some((user) => user.id === driver.userId && user.organizationId === organizationId),
  );
  const alerts: OperationalAlert[] = [];
  const activeOrders = tenantOrders.filter((order) => activeOrderStatuses.has(order.status));
  const driverAssignments = new Map<string, Order>();
  for (const order of activeOrders) {
    if (!order.assignedDriverId) continue;
    if (!driverAssignments.has(order.assignedDriverId)) driverAssignments.set(order.assignedDriverId, order);
    const driver = tenantDrivers.find((item) => item.id === order.assignedDriverId);
    if (!driver) continue;
    const ageMinutes = Math.max(0, (now - new Date(driver.lastSeenAt).getTime()) / 60_000);
    if (ageMinutes >= staleMinutes) {
      alerts.push({
        id: `stale_gps:${driver.id}`,
        organizationId,
        type: "stale_gps",
        severity: ageMinutes >= staleMinutes * 3 ? "critical" : "warning",
        title: "Driver GPS is stale",
        description: `${driver.name} has not reported a location for ${Math.round(ageMinutes)} minutes.`,
        driverId: driver.id,
        orderId: order.id,
        threshold: staleMinutes,
        value: round(ageMinutes),
        unit: "minutes",
        createdAt: new Date().toISOString(),
      });
    }
  }

  for (const order of activeOrders) {
    if (!order.assignedDriverId) continue;
    const driver = tenantDrivers.find((item) => item.id === order.assignedDriverId);
    if (!driver) continue;
    for (const kind of ["pickup", "dropoff"] as const) {
      const arrival = order.events
        .filter((event) => event.type === `geofence_${kind}_arrival`)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (!arrival) continue;
      const departure = order.events
        .filter((event) => event.type === `geofence_${kind}_departure` && event.createdAt >= arrival.createdAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (departure) continue;
      const ageMinutes = Math.max(0, (now - new Date(arrival.createdAt).getTime()) / 60_000);
      if (ageMinutes < dwellMinutes) continue;
      alerts.push({
        id: `excessive_dwell:${order.id}:${kind}:${arrival.createdAt}`,
        organizationId,
        type: "excessive_dwell",
        severity: ageMinutes >= dwellMinutes * 2 ? "critical" : "warning",
        title: `Excessive ${kind} dwell`,
        description: `${driver.name} has remained at the ${kind} geofence for ${Math.round(ageMinutes)} minutes without a departure event.`,
        driverId: driver.id,
        orderId: order.id,
        threshold: dwellMinutes,
        value: round(ageMinutes),
        unit: "minutes",
        createdAt: new Date().toISOString(),
      });
    }
  }

  const runs = await listRouteRuns(organizationId);
  for (const run of runs.filter((item) => item.status === "published" || item.status === "in_progress")) {
    const driver = tenantDrivers.find((item) => item.id === run.driverId);
    if (!driver) continue;
    const ageMinutes = Math.max(0, (now - new Date(driver.lastSeenAt).getTime()) / 60_000);
    if (ageMinutes >= staleMinutes) continue;
    const distanceKm = routeDistanceKm(driver.location, run.stops);
    if (distanceKm < deviationKm) continue;
    alerts.push({
      id: `route_deviation:${run.id}`,
      organizationId,
      type: "route_deviation",
      severity: distanceKm >= deviationKm * 2 ? "critical" : "warning",
      title: "Driver is off the planned route",
      description: `${driver.name} is approximately ${round(distanceKm)} km from the saved route corridor.`,
      driverId: driver.id,
      routeRunId: run.id,
      orderId: driverAssignments.get(driver.id)?.id,
      threshold: deviationKm,
      value: round(distanceKm),
      unit: "km",
      createdAt: new Date().toISOString(),
    });
  }
  return alerts.sort((a, b) => (a.severity === b.severity ? b.createdAt.localeCompare(a.createdAt) : a.severity === "critical" ? -1 : 1));
}
