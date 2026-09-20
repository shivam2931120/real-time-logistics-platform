import type { Driver, Order, OrganizationSettings } from "@routepulse/shared";
import { haversineKm } from "./optimizer.js";

export type EtaEstimate = {
  estimatedArrivalAt?: string;
  lateRisk?: boolean;
  etaConfidence?: "high" | "medium" | "low";
  locationAgeSeconds?: number;
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
): EtaEstimate => {
  if (terminalStatuses.has(order.status)) {
    return {
      estimatedArrivalAt: order.estimatedArrivalAt,
      lateRisk: order.lateRisk,
      etaConfidence: order.estimatedArrivalAt ? "high" : undefined,
    };
  }
  const driverLocation = driver?.location;
  const start = driverLocation ?? order.pickup;
  const distance = haversineKm(start, order.dropoff);
  const averageSpeedKph = Math.max(5, settings.averageSpeedKph || 24);
  const lastSeenAt = driver?.lastSeenAt ? new Date(driver.lastSeenAt).getTime() : NaN;
  const locationAgeSeconds = Number.isFinite(lastSeenAt)
    ? Math.max(0, Math.round((now - lastSeenAt) / 1_000))
    : undefined;
  // A stale GPS fix should remain useful, but make the ETA conservative and
  // visibly lower-confidence instead of presenting old coordinates as live.
  const stale = locationAgeSeconds === undefined || locationAgeSeconds > 10 * 60;
  const speed = stale ? Math.max(5, averageSpeedKph * 0.8) : averageSpeedKph;
  const travelMinutes = (distance / speed) * 60;
  const serviceMinutes = serviceMinutesFor(order.priority);
  let estimatedMs = now + (travelMinutes + serviceMinutes) * 60_000;
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
  };
};
