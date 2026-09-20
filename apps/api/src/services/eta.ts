import type {
  Driver,
  Order,
  OrganizationSettings,
  RouteRun,
} from "@routepulse/shared";
import { haversineKm } from "./optimizer.js";

export type EtaEstimate = {
  estimatedArrivalAt?: string;
  lateRisk?: boolean;
  etaConfidence?: "high" | "medium" | "low";
  locationAgeSeconds?: number;
  etaSource?: "direct" | "route_run";
};

const terminalStatuses = new Set(["delivered", "cancelled", "failed"]);
const serviceMinutesFor = (priority: Order["priority"]) => {
  if (priority === "urgent") return 4;
  if (priority === "express") return 5;
  return 6;
};

/** Calculate a fresh ETA from the latest persisted driver location. */
export const estimateEta = (
  order: Order,
  driver: Driver | undefined,
  settings: OrganizationSettings,
  now = Date.now(),
  activeRoute?: RouteRun,
): EtaEstimate => {
  if (terminalStatuses.has(order.status)) {
    return {
      estimatedArrivalAt: order.estimatedArrivalAt,
      lateRisk: order.lateRisk,
      etaConfidence: order.estimatedArrivalAt ? "high" : undefined,
      etaSource: order.estimatedArrivalAt ? "direct" : undefined,
    };
  }
  const driverLocation = driver?.location;
  const averageSpeedKph = Math.max(5, settings.averageSpeedKph || 24);
  const lastSeenAt = driver?.lastSeenAt ? new Date(driver.lastSeenAt).getTime() : NaN;
  const locationAgeSeconds = Number.isFinite(lastSeenAt)
    ? Math.max(0, Math.round((now - lastSeenAt) / 1_000))
    : undefined;
  // A stale GPS fix should remain useful, but make the ETA conservative and
  // visibly lower-confidence instead of presenting old coordinates as live.
  const stale = locationAgeSeconds === undefined || locationAgeSeconds > 10 * 60;
  const speed = stale ? Math.max(5, averageSpeedKph * 0.8) : averageSpeedKph;
  const routeIndex = activeRoute
    ? activeRoute.stops.findIndex((stop) => stop.id === order.id)
    : -1;
  const routeStops = routeIndex >= 0 ? activeRoute!.stops.slice(0, routeIndex + 1) : [];
  const start = driverLocation ?? order.pickup;
  const routeDistance = routeStops.reduce(
    (total, stop, index) =>
      total + haversineKm(index ? routeStops[index - 1]! : start, stop),
    0,
  );
  const distance = routeStops.length ? routeDistance : haversineKm(start, order.dropoff);
  const travelMinutes = (distance / speed) * 60;
  const serviceMinutes = serviceMinutesFor(order.priority);
  // Include the planned service dwell at earlier stops. The target stop's
  // service time is retained for compatibility with the existing ETA contract.
  const plannedStopsBeforeTarget = routeStops.length > 1 ? routeStops.length - 1 : 0;
  let estimatedMs =
    now +
    (travelMinutes +
      serviceMinutes +
      plannedStopsBeforeTarget * 6) *
      60_000;
  const windowStartMs = order.deliveryWindowStart
    ? new Date(order.deliveryWindowStart).getTime()
    : NaN;
  if (Number.isFinite(windowStartMs)) estimatedMs = Math.max(estimatedMs, windowStartMs);
  const estimatedArrivalAt = new Date(estimatedMs).toISOString();
  const promisedMs = new Date(order.promisedAt).getTime();
  return {
    estimatedArrivalAt,
    lateRisk: Number.isFinite(promisedMs) && estimatedMs > promisedMs,
    etaConfidence:
      driverLocation && locationAgeSeconds !== undefined && locationAgeSeconds <= 2 * 60
        ? "high"
        : driverLocation && locationAgeSeconds !== undefined && locationAgeSeconds <= 10 * 60
          ? "medium"
          : "low",
    locationAgeSeconds,
    etaSource: routeStops.length ? "route_run" : "direct",
  };
};
