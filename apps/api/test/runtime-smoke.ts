import "dotenv/config";
import { io } from "socket.io-client";
import { Pool } from "pg";

const base = process.env.API_URL || "http://127.0.0.1:4000";
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const request = async <T>(
  path: string,
  token?: string,
  options: RequestInit = {},
) => {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(
      `${path} returned ${response.status}: ${body.error || "unknown error"}`,
    );
  return body;
};
const login = async (role: string) =>
  request<{ token: string }>("/api/auth/demo", undefined, {
    method: "POST",
    body: JSON.stringify({ role }),
  });

const health = await request<{
  persistence: string;
  queue: string;
  payment: string;
}>("/health");
assert(
  health.persistence === "postgresql",
  `Expected PostgreSQL, got ${health.persistence}`,
);
const [{ token: dispatcher }, { token: driver }, { token: customer }] =
  await Promise.all([login("dispatcher"), login("driver"), login("customer")]);
const customerOrders = await request<Array<{ customerEmail: string }>>(
  "/api/orders",
  customer,
);
assert(
  customerOrders.length > 0 &&
    customerOrders.every(
      (order) => order.customerEmail === "customer@routepulse.demo",
    ),
  "Customer order isolation failed",
);

const created = await request<{
  id: string;
  trackingCode: string;
  status: string;
}>("/api/orders", dispatcher, {
  method: "POST",
  body: JSON.stringify({
    customerName: "Runtime Smoke",
    customerEmail: "runtime-smoke@example.com",
    pickup: { label: "Runtime Origin", lat: 12.9716, lng: 77.5946 },
    dropoff: { label: "Runtime Destination", lat: 12.9352, lng: 77.6245 },
    packageWeightKg: 2,
    priority: "standard",
    amount: 100,
    currency: "INR",
    promisedAt: new Date(Date.now() + 3_600_000).toISOString(),
  }),
});
assert(created.status === "pending", "Created order was not pending");
const assigned = await request<{ status: string }>(
  `/api/orders/${created.id}/assign`,
  dispatcher,
  { method: "POST", body: JSON.stringify({ driverId: "d_rohan" }) },
);
assert(assigned.status === "assigned", "Order assignment failed");

const socket = io(base, { auth: { token: driver }, transports: ["websocket"] });
await new Promise<void>((resolve, reject) => {
  socket.once("connect", () => resolve());
  socket.once("connect_error", reject);
});
const locationAck = await new Promise<{ ok?: boolean; error?: string }>(
  (resolve) =>
    socket.emit("location:update", { lat: 12.972, lng: 77.595 }, resolve),
);
socket.close();
assert(
  locationAck.ok,
  `Location update failed: ${locationAck.error || "unknown error"}`,
);
for (const status of ["picked_up", "in_transit"])
  await request(`/api/orders/${created.id}/status`, driver, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
await request(`/api/orders/${created.id}/proof`, driver, {
  method: "POST",
  body: JSON.stringify({
    recipientName: "Runtime Recipient",
    recipientPin: "1234",
    signatureData: "runtime-signature-confirmed",
  }),
});

assert(
  process.env.DATABASE_URL,
  "DATABASE_URL is required for runtime smoke verification",
);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const persisted = await pool.query<{
  status: string;
  event_count: string;
  driver_status: string;
}>(
  `SELECT o.status::text, count(e.id)::text AS event_count, d.status AS driver_status FROM orders o LEFT JOIN order_events e ON e.order_id=o.id LEFT JOIN drivers d ON d.id=o.assigned_driver_id WHERE o.id=$1 GROUP BY o.status,d.status`,
  [created.id],
);
assert(
  persisted.rows[0]?.status === "delivered",
  "Delivered status was not persisted",
);
assert(
  Number(persisted.rows[0]?.event_count) >= 5,
  "Order timeline was not persisted",
);
assert(
  persisted.rows[0]?.driver_status === "available",
  "Released driver state was not persisted",
);
await pool.query("DELETE FROM orders WHERE id=$1", [created.id]);
await pool.end();
console.info(
  JSON.stringify({
    ok: true,
    orderIdStable: true,
    health,
    persisted: persisted.rows[0],
    cleanedUp: true,
  }),
);
