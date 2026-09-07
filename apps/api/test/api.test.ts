import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import {
  auditRecords,
  deliveryExceptions,
  drivers,
  notificationRecords,
  orders,
  organizationSettings,
  parcelScans,
  supportMessages,
  supportTickets,
  users,
} from "../src/domain/store.js";
const app = createApp();
async function token(role: string) {
  return (await request(app).post("/api/auth/demo").send({ role })).body.token;
}
describe("API", () => {
  beforeEach(() => {
    orders.splice(
      0,
      orders.length,
      ...orders.filter((o) => o.id.startsWith("ord_1") || o.id === "ord_0999"),
    );
    drivers.find((d) => d.id === "d_rohan")!.status = "available";
    drivers.find((d) => d.id === "d_meera")!.status = "busy";
    deliveryExceptions.splice(0);
    notificationRecords.splice(0);
    auditRecords.splice(0);
    parcelScans.splice(0);
    supportMessages.splice(0);
    supportTickets.splice(0);
    users.find((user) => user.id === "u_customer")!.role = "customer";
    Object.assign(organizationSettings, {
      name: "RoutePulse",
      timezone: "Asia/Kolkata",
      geofenceRadiusMeters: 150,
      averageSpeedKph: 24,
      notificationsEnabled: true,
    });
  });
  it("reports honest adapter modes", async () => {
    const r = await request(app).get("/health");
    expect(r.status).toBe(200);
    expect(r.body.persistence).toBe("memory-demo");
  });
  it("allows both local frontend origins", async () => {
    for (const origin of ["http://localhost:5173", "http://127.0.0.1:5173"]) {
      const response = await request(app)
        .options("/api/auth/demo")
        .set("origin", origin)
        .set("access-control-request-method", "POST");
      expect(response.status).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe(origin);
    }
  });
  it("rejects private access without a session", async () => {
    expect((await request(app).get("/api/orders")).status).toBe(401);
  });
  it("validates public map operations without contacting a provider", async () => {
    const route = await request(app)
      .post("/api/maps/route")
      .send({ points: [{ lat: 12.97, lng: 77.59 }] });
    const search = await request(app).get("/api/maps/search?query=ab");
    expect(route.status).toBe(400);
    expect(search.status).toBe(400);
  });
  it("returns expanded analytics for a validated reporting window", async () => {
    const auth = await token("dispatcher");
    const response = await request(app)
      .get("/api/analytics/summary?days=30")
      .set("authorization", `Bearer ${auth}`);
    expect(response.status).toBe(200);
    expect(response.body.windowDays).toBe(30);
    expect(response.body).toEqual(
      expect.objectContaining({
        completionRate: expect.any(Number),
        paymentCollectionRate: expect.any(Number),
        totalRouteKm: expect.any(Number),
        geofence: expect.any(Object),
        driverPerformance: expect.any(Array),
        priorityPerformance: expect.any(Array),
        zonePerformance: expect.any(Array),
      }),
    );
  });
  it("creates, assigns, and prevents an invalid transition", async () => {
    const auth = await token("dispatcher");
    const created = await request(app)
      .post("/api/orders")
      .set("authorization", `Bearer ${auth}`)
      .send({
        customerName: "Test User",
        customerEmail: "test@example.com",
        pickup: { label: "Origin Hub", lat: 12.97, lng: 77.59 },
        dropoff: { label: "Destination", lat: 12.95, lng: 77.61 },
        packageWeightKg: 2,
        priority: "standard",
        amount: 100,
        currency: "INR",
        promisedAt: new Date(Date.now() + 3600000).toISOString(),
      });
    expect(created.status).toBe(201);
    expect(created.body.id).toMatch(/^[0-9a-f-]{36}$/);
    const bad = await request(app)
      .patch(`/api/orders/${created.body.id}/status`)
      .set("authorization", `Bearer ${auth}`)
      .send({ status: "delivered" });
    expect(bad.status).toBe(409);
    const assigned = await request(app)
      .post(`/api/orders/${created.body.id}/assign`)
      .set("authorization", `Bearer ${auth}`)
      .send({});
    expect(assigned.status).toBe(200);
    expect(assigned.body.status).toBe("assigned");
  });
  it("enforces role permissions", async () => {
    const auth = await token("customer");
    expect(
      (
        await request(app)
          .get("/api/analytics/summary")
          .set("authorization", `Bearer ${auth}`)
      ).status,
    ).toBe(403);
  });
  it("limits customers to their own orders and payments", async () => {
    const auth = await token("customer");
    const listed = await request(app)
      .get("/api/orders")
      .set("authorization", `Bearer ${auth}`);
    expect(listed.body.map((order: { id: string }) => order.id)).toEqual([
      "ord_1002",
    ]);
    expect(
      (
        await request(app)
          .get("/api/orders/ord_1001")
          .set("authorization", `Bearer ${auth}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/payments/demo/ord_1001/confirm")
          .set("authorization", `Bearer ${auth}`)
          .send({})
      ).status,
    ).toBe(403);
  });
  it("rejects an explicitly selected ineligible driver", async () => {
    const auth = await token("dispatcher");
    const response = await request(app)
      .post("/api/orders/ord_1002/assign")
      .set("authorization", `Bearer ${auth}`)
      .send({ driverId: "d_meera" });
    expect(response.status).toBe(422);
  });
  it("returns a privacy-safe public snapshot with ETA and map coordinates", async () => {
    const response = await request(app).get("/api/track/RP-DEMO01");
    expect(response.status).toBe(200);
    expect(response.body.customerName).toBe("Ananya");
    expect(response.body.customerEmail).toBeUndefined();
    expect(response.body.pickup).toEqual(
      expect.objectContaining({ lat: expect.any(Number) }),
    );
    expect(response.body.estimatedArrivalAt).toEqual(expect.any(String));
    expect(response.body.lateRisk).toEqual(expect.any(Boolean));
  });
  it("supports the driver accept, reject, and PIN-protected proof workflow", async () => {
    const dispatcher = await token("dispatcher");
    const created = await request(app)
      .post("/api/orders")
      .set("authorization", `Bearer ${dispatcher}`)
      .send({
        customerName: "Proof User",
        customerEmail: "proof@example.com",
        pickup: { label: "Origin Hub", lat: 12.97, lng: 77.59 },
        dropoff: { label: "Destination", lat: 12.95, lng: 77.61 },
        packageWeightKg: 2,
        priority: "standard",
        amount: 100,
        currency: "INR",
        recipientPin: "4321",
        deliveryWindowStart: new Date(Date.now() + 60000).toISOString(),
        promisedAt: new Date(Date.now() + 3600000).toISOString(),
      });
    await request(app)
      .post(`/api/orders/${created.body.id}/assign`)
      .set("authorization", `Bearer ${dispatcher}`)
      .send({ driverId: "d_rohan" });
    const driver = await token("driver");
    expect(
      (
        await request(app)
          .post(`/api/orders/${created.body.id}/accept`)
          .set("authorization", `Bearer ${driver}`)
          .send({})
      ).status,
    ).toBe(200);
    await request(app)
      .patch(`/api/orders/${created.body.id}/status`)
      .set("authorization", `Bearer ${driver}`)
      .send({ status: "picked_up" });
    await request(app)
      .patch(`/api/orders/${created.body.id}/status`)
      .set("authorization", `Bearer ${driver}`)
      .send({ status: "in_transit" });
    expect(
      (
        await request(app)
          .patch(`/api/orders/${created.body.id}/status`)
          .set("authorization", `Bearer ${driver}`)
          .send({ status: "delivered" })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post(`/api/orders/${created.body.id}/proof`)
          .set("authorization", `Bearer ${driver}`)
          .send({
            recipientName: "Receiver",
            recipientPin: "0000",
            signatureData: "typed:Receiver",
          })
      ).status,
    ).toBe(400);
    const delivered = await request(app)
      .post(`/api/orders/${created.body.id}/proof`)
      .set("authorization", `Bearer ${driver}`)
      .send({
        recipientName: "Receiver",
        recipientPin: "4321",
        signatureData: "typed:Receiver",
      });
    expect(delivered.status).toBe(200);
    expect(delivered.body.status).toBe("delivered");
    expect(delivered.body.proof.recipientName).toBe("Receiver");
  });
  it("creates and resolves operational exceptions", async () => {
    const auth = await token("dispatcher");
    const created = await request(app)
      .post("/api/orders/ord_1001/exceptions")
      .set("authorization", `Bearer ${auth}`)
      .send({ type: "delay", description: "Heavy traffic" });
    expect(created.status).toBe(201);
    const resolved = await request(app)
      .patch(`/api/exceptions/${created.body.id}/resolve`)
      .set("authorization", `Bearer ${auth}`)
      .send({ resolution: "Alternative route assigned" });
    expect(resolved.body.status).toBe("resolved");
    expect(
      (
        await request(app)
          .get("/api/exceptions")
          .set("authorization", `Bearer ${auth}`)
      ).body,
    ).toHaveLength(1);
  });
  it("records notifications, admin changes, settings, and audit events", async () => {
    const dispatcher = await token("dispatcher");
    await request(app)
      .post("/api/orders")
      .set("authorization", `Bearer ${dispatcher}`)
      .send({
        customerName: "Inbox User",
        customerEmail: "inbox@example.com",
        pickup: { label: "Origin Hub", lat: 12.97, lng: 77.59 },
        dropoff: { label: "Destination", lat: 12.95, lng: 77.61 },
        packageWeightKg: 2,
        priority: "standard",
        amount: 100,
        currency: "INR",
        promisedAt: new Date(Date.now() + 3600000).toISOString(),
      });
    expect(
      (
        await request(app)
          .get("/api/notifications")
          .set("authorization", `Bearer ${dispatcher}`)
      ).body.length,
    ).toBeGreaterThan(0);
    const admin = await token("admin");
    expect(
      (
        await request(app)
          .patch("/api/admin/users/u_customer/role")
          .set("authorization", `Bearer ${admin}`)
          .send({ role: "dispatcher" })
      ).body.role,
    ).toBe("dispatcher");
    const settings = await request(app)
      .put("/api/settings")
      .set("authorization", `Bearer ${admin}`)
      .send({ ...organizationSettings, geofenceRadiusMeters: 200 });
    expect(settings.body.geofenceRadiusMeters).toBe(200);
    expect(
      (
        await request(app)
          .get("/api/admin/audit")
          .set("authorization", `Bearer ${admin}`)
      ).body.length,
    ).toBeGreaterThan(0);
  });
  it("supports customer self-service reschedule and cancellation", async () => {
    const customer = await token("customer");
    const rescheduled = await request(app)
      .patch("/api/customer/orders/ord_1002/reschedule")
      .set("authorization", `Bearer ${customer}`)
      .send({
        deliveryWindowStart: new Date(Date.now() + 7200000).toISOString(),
        promisedAt: new Date(Date.now() + 10800000).toISOString(),
      });
    expect(rescheduled.status).toBe(200);
    expect(rescheduled.body.rescheduleCount).toBe(1);
    const dispatcher = await token("dispatcher");
    const created = await request(app)
      .post("/api/orders")
      .set("authorization", `Bearer ${dispatcher}`)
      .send({
        customerName: "Kabir Customer",
        customerEmail: "customer@routepulse.demo",
        pickup: { label: "Origin Hub", lat: 12.97, lng: 77.59 },
        dropoff: { label: "Destination", lat: 12.95, lng: 77.61 },
        packageWeightKg: 2,
        priority: "standard",
        amount: 100,
        currency: "INR",
        promisedAt: new Date(Date.now() + 3600000).toISOString(),
      });
    const cancelled = await request(app)
      .post(`/api/customer/orders/${created.body.id}/cancel`)
      .set("authorization", `Bearer ${customer}`)
      .send({});
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
  });
  it("records idempotent parcel scans and validates the parcel code", async () => {
    const dispatcher = await token("dispatcher");
    const order = (
      await request(app)
        .get("/api/orders")
        .set("authorization", `Bearer ${dispatcher}`)
    ).body.find((item: { id: string }) => item.id === "ord_1001");
    const first = await request(app)
      .post(`/api/orders/${order.id}/scans`)
      .set("authorization", `Bearer ${dispatcher}`)
      .send({ parcelCode: order.parcelCode, stage: "pickup" });
    expect(first.status).toBe(201);
    const duplicate = await request(app)
      .post(`/api/orders/${order.id}/scans`)
      .set("authorization", `Bearer ${dispatcher}`)
      .send({ parcelCode: order.parcelCode, stage: "pickup" });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.id).toBe(first.body.id);
    const mismatch = await request(app)
      .post(`/api/orders/${order.id}/scans`)
      .set("authorization", `Bearer ${dispatcher}`)
      .send({ parcelCode: "WRONG-CODE", stage: "hub" });
    expect(mismatch.status).toBe(400);
  });
  it("exports tenant-scoped CSV reports and provides a support thread", async () => {
    const dispatcher = await token("dispatcher");
    const csv = await request(app)
      .get("/api/reports/orders.csv")
      .set("authorization", `Bearer ${dispatcher}`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("tracking_code,parcel_code");
    const customer = await token("customer");
    const created = await request(app)
      .post("/api/support/tickets")
      .set("authorization", `Bearer ${customer}`)
      .send({
        subject: "Where is my parcel?",
        category: "delivery",
        message: "Please share an update.",
      });
    expect(created.status).toBe(201);
    const message = await request(app)
      .post(`/api/support/tickets/${created.body.id}/messages`)
      .set("authorization", `Bearer ${customer}`)
      .send({ message: "I am available for delivery." });
    expect(message.status).toBe(201);
    expect(
      (
        await request(app)
          .get(`/api/support/tickets/${created.body.id}/messages`)
          .set("authorization", `Bearer ${customer}`)
      ).body,
    ).toHaveLength(2);
  });
});
