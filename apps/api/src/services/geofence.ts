import type { Coordinate, Order } from "@routepulse/shared";
import { haversineKm } from "./optimizer.js";

export type GeofenceTransition = {
  type:
    | "geofence_pickup_arrival"
    | "geofence_pickup_departure"
    | "geofence_dropoff_arrival"
    | "geofence_dropoff_departure";
  message: string;
};

type StopKind = "pickup" | "dropoff";

export function geofenceTransitions(
  order: Order,
  location: Coordinate,
  radiusMeters: number,
): GeofenceTransition[] {
  const stops: Array<{ kind: StopKind; point: Coordinate; enabled: boolean }> =
    [
      {
        kind: "pickup",
        point: order.pickup,
        enabled: ["assigned", "picked_up", "in_transit"].includes(order.status),
      },
      {
        kind: "dropoff",
        point: order.dropoff,
        enabled: ["picked_up", "in_transit"].includes(order.status),
      },
    ];
  const transitions: GeofenceTransition[] = [];
  for (const stop of stops) {
    if (!stop.enabled) continue;
    const prefix = `geofence_${stop.kind}` as const;
    const inside = haversineKm(location, stop.point) * 1000 <= radiusMeters;
    const arrived = order.events.some(
      (event) => event.type === `${prefix}_arrival`,
    );
    const departed = order.events.some(
      (event) => event.type === `${prefix}_departure`,
    );
    if (inside && !arrived) {
      transitions.push({
        type: `${prefix}_arrival`,
        message:
          stop.kind === "pickup"
            ? "Driver arrived at pickup geofence"
            : "Driver arrived at delivery geofence",
      });
    } else if (!inside && arrived && !departed) {
      transitions.push({
        type: `${prefix}_departure`,
        message:
          stop.kind === "pickup"
            ? "Driver departed pickup geofence"
            : "Driver departed delivery geofence",
      });
    }
  }
  return transitions;
}
