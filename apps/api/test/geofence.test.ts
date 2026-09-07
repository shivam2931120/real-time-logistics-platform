import { describe, expect, it } from "vitest";
import type { Order } from "@routepulse/shared";
import { geofenceTransitions } from "../src/services/geofence.js";

const order = (status: Order["status"], events: Order["events"] = []) =>
  ({
    id: "order-1",
    organizationId: "org_demo",
    trackingCode: "RP-GEOFENCE",
    customerName: "Customer",
    customerEmail: "customer@example.com",
    pickup: { label: "Pickup", lat: 12.9716, lng: 77.5946 },
    dropoff: { label: "Dropoff", lat: 12.9352, lng: 77.6245 },
    packageWeightKg: 1,
    priority: "standard",
    status,
    amount: 100,
    currency: "INR",
    paymentStatus: "paid",
    promisedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    events,
  }) as Order;

describe("geofence transitions", () => {
  it("records pickup arrival and departure once", () => {
    const atPickup = order("assigned");
    const arrival = geofenceTransitions(atPickup, atPickup.pickup, 150);
    expect(arrival.map((item) => item.type)).toEqual([
      "geofence_pickup_arrival",
    ]);
    atPickup.events.push({
      id: "arrival",
      type: "geofence_pickup_arrival",
      message: "arrived",
      createdAt: new Date().toISOString(),
    });
    const departure = geofenceTransitions(
      atPickup,
      { lat: 12.98, lng: 77.61 },
      150,
    );
    expect(departure.map((item) => item.type)).toEqual([
      "geofence_pickup_departure",
    ]);
  });

  it("tracks dropoff arrival without repeating existing transitions", () => {
    const atDropoff = order("in_transit");
    const transitions = geofenceTransitions(atDropoff, atDropoff.dropoff, 150);
    expect(transitions.map((item) => item.type)).toEqual([
      "geofence_dropoff_arrival",
    ]);
    atDropoff.events.push({
      id: "arrival",
      type: "geofence_dropoff_arrival",
      message: "arrived",
      createdAt: new Date().toISOString(),
    });
    expect(geofenceTransitions(atDropoff, atDropoff.dropoff, 150)).toEqual([]);
  });
});
