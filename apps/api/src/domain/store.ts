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
  ParcelScan,
  SupportMessage,
  SupportTicket,
} from "@routepulse/shared";
import { createHash, randomUUID } from "node:crypto";
import { assertTransition } from "./stateMachine.js";

const now = () => new Date().toISOString();
const org = "org_demo";
const distanceKm = (order: Order) => {
  const radius = 6371;
  const radians = Math.PI / 180;
  const latitude = (order.dropoff.lat - order.pickup.lat) * radians;
  const longitude = (order.dropoff.lng - order.pickup.lng) * radians;
  const value =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(order.pickup.lat * radians) *
      Math.cos(order.dropoff.lat * radians) *
      Math.sin(longitude / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(value));
};
const deliveryMinutes = (order: Order) =>
  order.deliveredAt
    ? (new Date(order.deliveredAt).getTime() -
        new Date(order.createdAt).getTime()) /
      60_000
    : 0;
const zoneName = (order: Order) =>
  order.dropoff.label.split(",")[0]?.trim() || "Other";
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
    shiftStart: "08:00",
    shiftEnd: "18:00",
    vehiclePlate: "KA-01-RP-101",
    maintenanceStatus: "ok",
  },
  {
    id: "d_meera",
    userId: "u_driver2",
    name: "Meera Driver",
    status: "busy",
    capacityKg: 120,
    location: { lat: 12.9352, lng: 77.6245 },
    lastSeenAt: now(),
    shiftStart: "09:00",
    shiftEnd: "19:00",
    vehiclePlate: "KA-01-RP-202",
    maintenanceStatus: "due",
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
    parcelCode: "PKG-RP-DEMO01",
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
    parcelCode: "PKG-RP-DEMO02",
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
    parcelCode: "PKG-RP-DEMO99",
  },
];
export const deliveryExceptions: DeliveryException[] = [];
export const notificationRecords: NotificationRecord[] = [];
export const auditRecords: AuditRecord[] = [];
export const parcelScans: ParcelScan[] = [];
export const supportTickets: SupportTicket[] = [];
export const supportMessages: SupportMessage[] = [];
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
      parcelCode:
        input.parcelCode || `PKG-${randomUUID().slice(0, 8).toUpperCase()}`,
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
  summary(tenant: string, windowDays = 7): AnalyticsSummary {
    const safeWindowDays = Math.min(90, Math.max(7, Math.round(windowDays)));
    const cutoff = Date.now() - safeWindowDays * 24 * 60 * 60 * 1000;
    const tenantOrders = orders.filter(
      (order) =>
        order.organizationId === tenant &&
        new Date(order.createdAt).getTime() >= cutoff,
    );
    const previousCutoff = cutoff - safeWindowDays * 24 * 60 * 60 * 1000;
    const previousOrders = orders.filter((order) => {
      const created = new Date(order.createdAt).getTime();
      return (
        order.organizationId === tenant &&
        created >= previousCutoff &&
        created < cutoff
      );
    });
    const tenantDriverIds = new Set(
      drivers
        .filter((driver) =>
          users.some(
            (user) =>
              user.id === driver.userId && user.organizationId === tenant,
          ),
        )
        .map((driver) => driver.id),
    );
    const tenantDrivers = drivers.filter((driver) =>
      tenantDriverIds.has(driver.id),
    );
    const delivered = tenantOrders.filter((o) => o.status === "delivered");
    const onTime = delivered.filter(
      (o) => o.deliveredAt! <= o.promisedAt,
    ).length;
    const paid = tenantOrders.filter((order) => order.paymentStatus === "paid");
    const revenue = paid.reduce((total, order) => total + order.amount, 0);
    const previousDelivered = previousOrders.filter(
      (order) => order.status === "delivered",
    );
    const previousOnTime = previousDelivered.filter(
      (order) => order.deliveredAt! <= order.promisedAt,
    );
    const previousRevenue = previousOrders
      .filter((order) => order.paymentStatus === "paid")
      .reduce((total, order) => total + order.amount, 0);
    const percentDelta = (current: number, previous: number) =>
      previous === 0
        ? current === 0
          ? 0
          : 100
        : Math.round(((current - previous) / previous) * 100);
    const routeKm = tenantOrders.reduce(
      (total, order) => total + distanceKm(order),
      0,
    );
    const activeOrders = tenantOrders.filter((order) =>
      ["assigned", "picked_up", "in_transit"].includes(order.status),
    );
    const geofenceEvents = tenantOrders.flatMap((order) => order.events);
    const arrivals = geofenceEvents.filter((event) =>
      event.type.endsWith("_arrival"),
    );
    const departures = geofenceEvents.filter((event) =>
      event.type.endsWith("_departure"),
    );
    const geofenceSessions = tenantOrders.flatMap((order) =>
      (["pickup", "dropoff"] as const).map((kind) => {
        const relevant = order.events
          .filter((event) =>
            [
              `geofence_${kind}_arrival`,
              `geofence_${kind}_departure`,
            ].includes(event.type),
          )
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
        const dwellMinutes: number[] = [];
        let arrivedAt: number | undefined;
        for (const event of relevant) {
          if (event.type.endsWith("_arrival")) {
            arrivedAt = new Date(event.createdAt).getTime();
          } else if (arrivedAt !== undefined) {
            dwellMinutes.push(
              Math.max(
                0,
                (new Date(event.createdAt).getTime() - arrivedAt) / 60_000,
              ),
            );
            arrivedAt = undefined;
          }
        }
        return { dwellMinutes, inside: arrivedAt !== undefined };
      }),
    );
    const dwellSamples = geofenceSessions.flatMap(
      (session) => session.dwellMinutes,
    );
    const currentlyInside = geofenceSessions.filter(
      (session) => session.inside,
    ).length;
    const trend = Array.from({ length: safeWindowDays }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - safeWindowDays + 1 + i);
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
    const priorityPerformance = (
      ["standard", "express", "urgent"] as const
    ).map((priority) => {
      const group = tenantOrders.filter((order) => order.priority === priority);
      const completed = group.filter((order) => order.status === "delivered");
      const punctual = completed.filter(
        (order) => order.deliveredAt! <= order.promisedAt,
      );
      return {
        priority,
        orders: group.length,
        delivered: completed.length,
        onTimeRate: completed.length
          ? Math.round((punctual.length / completed.length) * 100)
          : 100,
        averageDeliveryMinutes: completed.length
          ? Math.round(
              completed.reduce(
                (total, order) => total + deliveryMinutes(order),
                0,
              ) / completed.length,
            )
          : 0,
      };
    });
    const driverPerformance = tenantDrivers.map((driver) => {
      const assigned = tenantOrders.filter(
        (order) => order.assignedDriverId === driver.id,
      );
      const completed = assigned.filter(
        (order) => order.status === "delivered",
      );
      const punctual = completed.filter(
        (order) => order.deliveredAt! <= order.promisedAt,
      );
      return {
        driverId: driver.id,
        driverName: driver.name,
        assigned: assigned.length,
        completed: completed.length,
        onTimeRate: completed.length
          ? Math.round((punctual.length / completed.length) * 100)
          : 100,
        activeLoadKg: +assigned
          .filter((order) =>
            ["assigned", "picked_up", "in_transit"].includes(order.status),
          )
          .reduce((total, order) => total + order.packageWeightKg, 0)
          .toFixed(1),
      };
    });
    const zones = [...new Set(tenantOrders.map(zoneName))];
    const zonePerformance = zones
      .map((zone) => {
        const group = tenantOrders.filter((order) => zoneName(order) === zone);
        const completed = group.filter((order) => order.status === "delivered");
        const punctual = completed.filter(
          (order) => order.deliveredAt! <= order.promisedAt,
        );
        return {
          zone,
          orders: group.length,
          delivered: completed.length,
          onTimeRate: completed.length
            ? Math.round((punctual.length / completed.length) * 100)
            : 100,
          revenue: group
            .filter((order) => order.paymentStatus === "paid")
            .reduce((total, order) => total + order.amount, 0),
        };
      })
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 8);
    return {
      windowDays: safeWindowDays,
      totalOrders: tenantOrders.length,
      activeDrivers: tenantDrivers.filter((d) => d.status !== "offline").length,
      deliveriesToday: delivered.filter(
        (o) => o.deliveredAt?.slice(0, 10) === now().slice(0, 10),
      ).length,
      onTimeRate: delivered.length
        ? Math.round((onTime / delivered.length) * 100)
        : 100,
      completionRate: tenantOrders.length
        ? Math.round((delivered.length / tenantOrders.length) * 100)
        : 0,
      paymentCollectionRate: tenantOrders.length
        ? Math.round((paid.length / tenantOrders.length) * 100)
        : 0,
      atRiskDeliveries: activeOrders.filter(
        (order) =>
          order.lateRisk ||
          (order.estimatedArrivalAt
            ? order.estimatedArrivalAt > order.promisedAt
            : new Date(order.promisedAt).getTime() < Date.now()),
      ).length,
      openExceptions: deliveryExceptions.filter(
        (item) => item.organizationId === tenant && item.status === "open",
      ).length,
      revenue,
      revenuePerDelivery: delivered.length
        ? Math.round(revenue / delivered.length)
        : 0,
      averageDeliveryMinutes: delivered.length
        ? Math.round(
            delivered.reduce(
              (total, order) => total + deliveryMinutes(order),
              0,
            ) / delivered.length,
          )
        : 0,
      totalRouteKm: +routeKm.toFixed(1),
      averageRouteKm: tenantOrders.length
        ? +(routeKm / tenantOrders.length).toFixed(1)
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
      geofence: {
        arrivals: arrivals.length,
        departures: departures.length,
        currentlyInside,
        averageDwellMinutes: dwellSamples.length
          ? +(
              dwellSamples.reduce((total, minutes) => total + minutes, 0) /
              dwellSamples.length
            ).toFixed(1)
          : 0,
      },
      priorityPerformance,
      driverPerformance,
      zonePerformance,
      comparison: {
        previousWindowDays: safeWindowDays,
        ordersDeltaPct: percentDelta(tenantOrders.length, previousOrders.length),
        revenueDeltaPct: percentDelta(revenue, previousRevenue),
        onTimeRateDelta:
          (delivered.length
            ? Math.round((onTime / delivered.length) * 100)
            : 100) -
          (previousDelivered.length
            ? Math.round((previousOnTime.length / previousDelivered.length) * 100)
            : 100),
        completionRateDelta:
          (tenantOrders.length
            ? Math.round((delivered.length / tenantOrders.length) * 100)
            : 0) -
          (previousOrders.length
            ? Math.round((previousDelivered.length / previousOrders.length) * 100)
            : 0),
      },
    };
  },
};
