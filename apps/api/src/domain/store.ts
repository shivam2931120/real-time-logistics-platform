import type {
  AnalyticsSummary,
  AuditRecord,
  DeliveryException,
  Driver,
  NotificationRecord,
  Order,
  OrderEvent,
  OrderStatus,
  OrganizationSettings,
  User,
} from "@routepulse/shared";
import { createHash, randomUUID } from "node:crypto";
import { assertTransition } from "./stateMachine.js";

const now = () => new Date().toISOString();
const org = "org_demo";
export const users: User[] = [
  {
    id: "u_admin",
    organizationId: org,
    name: "Aarav Admin",
    email: "admin@routepulse.demo",
    role: "admin",
  },
  {
    id: "u_dispatch",
    organizationId: org,
    name: "Diya Dispatcher",
    email: "dispatch@routepulse.demo",
    role: "dispatcher",
  },
  {
    id: "u_driver1",
    organizationId: org,
    name: "Rohan Driver",
    email: "rohan@routepulse.demo",
    role: "driver",
  },
  {
    id: "u_driver2",
    organizationId: org,
    name: "Meera Driver",
    email: "meera@routepulse.demo",
    role: "driver",
  },
  {
    id: "u_customer",
    organizationId: org,
    name: "Kabir Customer",
    email: "customer@routepulse.demo",
    role: "customer",
  },
];
export const drivers: Driver[] = [
  {
    id: "d_rohan",
    userId: "u_driver1",
    name: "Rohan Driver",
    status: "available",
    capacityKg: 80,
    location: { lat: 12.9716, lng: 77.5946 },
    lastSeenAt: now(),
  },
  {
    id: "d_meera",
    userId: "u_driver2",
    name: "Meera Driver",
    status: "busy",
    capacityKg: 120,
    location: { lat: 12.9352, lng: 77.6245 },
    lastSeenAt: now(),
  },
];
const event = (
  type: string,
  message: string,
  actorId?: string,
): OrderEvent => ({
  id: randomUUID(),
  type,
  message,
  actorId,
  createdAt: now(),
});
export const orders: Order[] = [
  {
    id: "ord_1001",
    organizationId: org,
    trackingCode: "RP-DEMO01",
    customerName: "Ananya Rao",
    customerEmail: "ananya@example.com",
    pickup: { label: "Indiranagar Hub", lat: 12.9784, lng: 77.6408 },
    dropoff: { label: "Koramangala 5th Block", lat: 12.9352, lng: 77.6245 },
    packageWeightKg: 4.5,
    priority: "express",
    status: "in_transit",
    amount: 349,
    currency: "INR",
    paymentStatus: "paid",
    assignedDriverId: "d_meera",
    promisedAt: new Date(Date.now() + 45 * 60_000).toISOString(),
    createdAt: new Date(Date.now() - 70 * 60_000).toISOString(),
    updatedAt: now(),
    events: [
      event("created", "Order created"),
      event("assigned", "Assigned to Meera"),
      event("picked_up", "Package picked up"),
      event("in_transit", "Delivery is on the way"),
    ],
  },
  {
    id: "ord_1002",
    organizationId: org,
    trackingCode: "RP-DEMO02",
    customerName: "Kabir Customer",
    customerEmail: "customer@routepulse.demo",
    pickup: { label: "Indiranagar Hub", lat: 12.9784, lng: 77.6408 },
    dropoff: { label: "Malleshwaram", lat: 13.0035, lng: 77.5649 },
    packageWeightKg: 9,
    priority: "standard",
    status: "pending",
    amount: 249,
    currency: "INR",
    paymentStatus: "unpaid",
    promisedAt: new Date(Date.now() + 150 * 60_000).toISOString(),
    createdAt: now(),
    updatedAt: now(),
    events: [event("created", "Order created")],
  },
  {
    id: "ord_0999",
    organizationId: org,
    trackingCode: "RP-DEMO99",
    customerName: "Sara Khan",
    customerEmail: "sara@example.com",
    pickup: { label: "Indiranagar Hub", lat: 12.9784, lng: 77.6408 },
    dropoff: { label: "Jayanagar", lat: 12.925, lng: 77.5938 },
    packageWeightKg: 2,
    priority: "urgent",
    status: "delivered",
    amount: 499,
    currency: "INR",
    paymentStatus: "paid",
    assignedDriverId: "d_rohan",
    promisedAt: new Date(Date.now() - 5 * 3600_000).toISOString(),
    createdAt: new Date(Date.now() - 7 * 3600_000).toISOString(),
    updatedAt: new Date(Date.now() - 6 * 3600_000).toISOString(),
    deliveredAt: new Date(Date.now() - 6 * 3600_000).toISOString(),
    events: [
      event("created", "Order created"),
      event("delivered", "Delivered successfully"),
    ],
  },
];
export const deliveryExceptions: DeliveryException[] = [];
export const notificationRecords: NotificationRecord[] = [];
export const auditRecords: AuditRecord[] = [];
export const organizationSettings: OrganizationSettings = {
  organizationId: org,
  name: "RoutePulse",
  timezone: "Asia/Kolkata",
  geofenceRadiusMeters: 150,
  averageSpeedKph: 24,
  notificationsEnabled: true,
};
const deliveryPins = new Map<string, string>();
const pinHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
orders.forEach((order) => deliveryPins.set(order.id, pinHash("1234")));

export const store = {
  listOrders: (tenant: string) =>
    orders.filter((o) => o.organizationId === tenant),
  getOrder: (id: unknown, tenant: string) =>
    orders.find((o) => o.id === String(id) && o.organizationId === tenant),
  createOrder(
    input: Omit<
      Order,
      | "id"
      | "trackingCode"
      | "createdAt"
      | "updatedAt"
      | "events"
      | "status"
      | "paymentStatus"
      | "organizationId"
    >,
    actor: User,
  ) {
    const createdAt = now();
    const id = randomUUID();
    const order: Order = {
      ...input,
      id,
      organizationId: actor.organizationId,
      trackingCode: `RP-${randomUUID().slice(0, 6).toUpperCase()}`,
      status: "pending",
      paymentStatus: "unpaid",
      createdAt,
      updatedAt: createdAt,
      events: [event("created", "Order created", actor.id)],
    };
    orders.unshift(order);
    return order;
  },
  setDeliveryPin(orderId: string, pin: string) {
    deliveryPins.set(orderId, pinHash(pin));
  },
  setDeliveryPinHash(orderId: string, hash: string) {
    deliveryPins.set(orderId, hash);
  },
  deliveryPinHash(orderId: string) {
    return deliveryPins.get(orderId);
  },
  verifyDeliveryPin(orderId: string, pin: string) {
    const expected = deliveryPins.get(orderId);
    return Boolean(expected && expected === pinHash(pin));
  },
  assign(order: Order, driver: Driver, actor: User) {
    if (order.status !== "pending")
      throw Object.assign(new Error("Only pending orders can be assigned"), {
        status: 409,
      });
    order.assignedDriverId = driver.id;
    order.status = "assigned";
    order.updatedAt = now();
    driver.status = "busy";
    order.events.push(
      event("assigned", `Assigned to ${driver.name}`, actor.id),
    );
    return order;
  },
  transition(order: Order, status: OrderStatus, actor: User) {
    assertTransition(order.status, status);
    order.status = status;
    order.updatedAt = now();
    if (status === "delivered") order.deliveredAt = now();
    if (
      status === "delivered" ||
      status === "cancelled" ||
      status === "failed"
    ) {
      const d = drivers.find((x) => x.id === order.assignedDriverId);
      if (d) d.status = "available";
    }
    order.events.push(
      event(status, `Status changed to ${status.replace("_", " ")}`, actor.id),
    );
    return order;
  },
  summary(tenant: string): AnalyticsSummary {
    const tenantOrders = orders.filter((o) => o.organizationId === tenant);
    const delivered = tenantOrders.filter((o) => o.status === "delivered");
    const onTime = delivered.filter(
      (o) => o.deliveredAt! <= o.promisedAt,
    ).length;
    const trend = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - 6 + i);
      const key = d.toISOString().slice(0, 10);
      const day = tenantOrders.filter((o) => o.deliveredAt?.startsWith(key));
      return {
        date: key!,
        deliveries: day.length,
        revenue: day
          .filter((o) => o.paymentStatus === "paid")
          .reduce((n, o) => n + o.amount, 0),
      };
    });
    return {
      activeDrivers: drivers.filter((d) => d.status !== "offline").length,
      deliveriesToday: delivered.filter(
        (o) => o.deliveredAt?.slice(0, 10) === now().slice(0, 10),
      ).length,
      onTimeRate: delivered.length
        ? Math.round((onTime / delivered.length) * 100)
        : 100,
      revenue: tenantOrders
        .filter((o) => o.paymentStatus === "paid")
        .reduce((n, o) => n + o.amount, 0),
      averageDeliveryMinutes: delivered.length
        ? Math.round(
            delivered.reduce(
              (n, o) =>
                n +
                (new Date(o.deliveredAt!).getTime() -
                  new Date(o.createdAt).getTime()) /
                  60000,
              0,
            ) / delivered.length,
          )
        : 0,
      statusCounts: Object.fromEntries(
        [
          "pending",
          "assigned",
          "picked_up",
          "in_transit",
          "delivered",
          "failed",
          "cancelled",
        ].map((s) => [s, tenantOrders.filter((o) => o.status === s).length]),
      ) as Record<OrderStatus, number>,
      trend,
    };
  },
};
