import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { z } from "zod";
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
  store,
  users,
} from "./domain/store.js";
import { authenticate, issueToken, permit } from "./http/auth.js";
import { haversineKm, optimizeRoute } from "./services/optimizer.js";
import {
  createCheckout,
  orderIdForRazorpayOrder,
  paymentMode,
  verifyRazorpayPayment,
  verifyRazorpayWebhook,
} from "./services/payments.js";
import { notificationMode, notify } from "./services/notifications.js";
import {
  persistAudit,
  persistDriver,
  persistException,
  persistExceptionAndOrder,
  persistNotification,
  persistOrder,
  persistOrderAndDriver,
  persistParcelScan,
  persistParcelScanAndOrder,
  persistProofAndDelivery,
  persistSettings,
  persistSupportMessage,
  persistSupportTicket,
  persistSupportTicketWithMessage,
  persistUserRole,
  persistenceMode,
} from "./db/persistence.js";
import { syncClerkWebhook } from "./services/clerkWebhook.js";
import type {
  AuditRecord,
  DeliveryException,
  Driver,
  NotificationRecord,
  Order,
  Role,
  User,
  ParcelScan,
  ParcelScanStage,
  SupportMessage,
  SupportTicket,
} from "@routepulse/shared";
import { allowedWebOrigins } from "./config/origins.js";

const coordinate = z.object({
  label: z.string().min(3).max(160),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
const createSchema = z
  .object({
    customerName: z.string().min(2).max(80),
    customerEmail: z.email(),
    pickup: coordinate,
    dropoff: coordinate,
    packageWeightKg: z.number().positive().max(1000),
    priority: z.enum(["standard", "express", "urgent"]),
    amount: z.number().nonnegative().max(1_000_000),
    currency: z
      .string()
      .length(3)
      .transform((s) => s.toUpperCase()),
    deliveryWindowStart: z.iso.datetime().optional(),
    deliveryNotes: z.string().max(500).optional(),
    parcelCode: z.string().trim().min(3).max(80).optional(),
    recipientPin: z
      .string()
      .regex(/^\d{4,6}$/)
      .default("1234"),
    promisedAt: z.iso.datetime(),
  })
  .refine(
    (value) =>
      !value.deliveryWindowStart ||
      value.deliveryWindowStart < value.promisedAt,
    {
      message: "Delivery window must start before its end",
      path: ["deliveryWindowStart"],
    },
  );
const statusSchema = z.object({
  status: z.enum([
    "pending",
    "assigned",
    "picked_up",
    "in_transit",
    "delivered",
    "failed",
    "cancelled",
  ]),
});
const parcelScanSchema = z.object({
  parcelCode: z.string().trim().min(3).max(80),
  stage: z.enum(["pickup", "hub", "delivery"]),
});
const supportTicketSchema = z.object({
  subject: z.string().trim().min(3).max(120),
  category: z.enum(["delivery", "payment", "address", "account", "other"]),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  orderId: z.string().optional(),
  message: z.string().trim().min(3).max(2_000),
});
const supportMessageSchema = z.object({
  message: z.string().trim().min(1).max(2_000),
  internal: z.boolean().default(false),
});
const driverForTenant = (driver: Driver, tenant: string) =>
  users.some(
    (user) => user.id === driver.userId && user.organizationId === tenant,
  );
const canAccessOrder = (user: User, order: Order) =>
  user.role !== "customer" ||
  order.customerEmail.toLowerCase() === user.email.toLowerCase();
const csvCell = (value: unknown) => {
  const raw = String(value ?? "");
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};
const csvRow = (values: unknown[]) => values.map(csvCell).join(",");
const canAccessTicket = (user: User, ticket: SupportTicket) => {
  if (user.role !== "customer") return true;
  return ticket.customerId === user.id || ticket.createdBy === user.id;
};
const restore = <T extends object>(target: T, snapshot: T) => {
  for (const key of Object.keys(target) as Array<keyof T>) delete target[key];
  Object.assign(target, structuredClone(snapshot));
};
const etaFor = (order: Order) => {
  if (["delivered", "cancelled", "failed"].includes(order.status)) return order;
  const driver = drivers.find((item) => item.id === order.assignedDriverId);
  const start = driver?.location || order.pickup;
  const distance = haversineKm(start, order.dropoff);
  const minutes = Math.max(
    5,
    Math.round(
      (distance / Math.max(5, organizationSettings.averageSpeedKph)) * 60 + 5,
    ),
  );
  const estimatedArrivalAt = new Date(
    Date.now() + minutes * 60_000,
  ).toISOString();
  return {
    ...order,
    estimatedArrivalAt,
    lateRisk: estimatedArrivalAt > order.promisedAt,
  };
};
const audit = async (
  user: User,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown> = {},
) => {
  const item: AuditRecord = {
    id: crypto.randomUUID(),
    organizationId: user.organizationId,
    actorId: user.id,
    action,
    resourceType,
    resourceId,
    metadata,
    createdAt: new Date().toISOString(),
  };
  auditRecords.unshift(item);
  await persistAudit(item);
  return item;
};
const notifySafely = async (order: Order, template: string) => {
  let status: "queued" | "sent" | "simulated" | "failed" = "failed";
  let mode: string = notificationMode();
  try {
    if (!organizationSettings.notificationsEnabled) {
      status = "simulated";
      mode = "disabled";
      return { status, mode };
    }
    const result = await notify(order, template);
    status = result.status as typeof status;
    mode = result.mode;
    return result;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "notification.enqueue_failed",
        orderId: order.id,
        template,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    return { status: "failed", mode };
  } finally {
    const target = users.find(
      (user) =>
        user.organizationId === order.organizationId &&
        user.email.toLowerCase() === order.customerEmail.toLowerCase(),
    );
    const record: NotificationRecord = {
      id: crypto.randomUUID(),
      organizationId: order.organizationId,
      userId: target?.id,
      orderId: order.id,
      channel: "email",
      title: `Delivery ${order.trackingCode}`,
      message: template.replaceAll("_", " "),
      status,
      createdAt: new Date().toISOString(),
    };
    notificationRecords.unshift(record);
    await persistNotification(record);
  }
};

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: allowedWebOrigins() }));
  app.use((req, res, next) =>
    ["/api/webhooks/razorpay", "/api/webhooks/clerk"].includes(req.path)
      ? express.raw({ type: "application/json", limit: "100kb" })(
          req,
          res,
          next,
        )
      : next(),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(pinoHttp({ redact: ["req.headers.authorization"] }));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.get("/health", (_req, res) =>
    res.json({
      status: "ok",
      auth: process.env.AUTH_MODE === "clerk" ? "clerk" : "demo",
      persistence: persistenceMode(),
      queue: notificationMode(),
      payment: paymentMode(),
      smtp: Boolean(
        process.env.GOOGLE_SMTP_USER && process.env.GOOGLE_SMTP_APP_PASSWORD,
      ),
      timestamp: new Date().toISOString(),
    }),
  );
  app.post("/api/auth/demo", (req, res) => {
    const parsed = z
      .object({ role: z.enum(["admin", "dispatcher", "driver", "customer"]) })
      .safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: "Invalid role", details: parsed.error.issues });
    const user = users.find((u) => u.role === parsed.data.role)!;
    return res.json({ token: issueToken(user), user });
  });
  app.get("/api/track/:code", (req, res) => {
    const found = orders.find(
      (o) =>
        o.trackingCode.toLowerCase() === String(req.params.code).toLowerCase(),
    );
    if (!found)
      return res.status(404).json({ error: "Tracking code not found" });
    const order = etaFor(found);
    const driver = drivers.find((d) => d.id === order.assignedDriverId);
    return res.json({
      trackingCode: order.trackingCode,
      customerName: order.customerName.split(" ")[0],
      status: order.status,
      priority: order.priority,
      destination: order.dropoff.label,
      pickup: order.pickup,
      dropoff: order.dropoff,
      driver: driver
        ? {
            name: driver.name.split(" ")[0],
            location: driver.location,
            lastSeenAt: driver.lastSeenAt,
          }
        : null,
      deliveryWindowStart: order.deliveryWindowStart,
      promisedAt: order.promisedAt,
      estimatedArrivalAt: order.estimatedArrivalAt,
      lateRisk: Boolean(order.lateRisk),
      updatedAt: order.updatedAt,
      proof: order.proof
        ? {
            recipientName: order.proof.recipientName,
            createdAt: order.proof.createdAt,
          }
        : undefined,
      events: order.events.map(({ type, message, createdAt }) => ({
        type,
        message,
        createdAt,
      })),
    });
  });
  app.post("/api/webhooks/razorpay", async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const signature = String(req.header("x-razorpay-signature") || "");
    if (!verifyRazorpayWebhook(raw, signature))
      return res
        .status(400)
        .json({ error: "Invalid Razorpay webhook signature" });
    try {
      const body = JSON.parse(raw.toString("utf8")) as {
        event?: string;
        payload?: {
          payment?: {
            entity?: {
              order_id?: string;
              notes?: { routepulseOrderId?: string };
            };
          };
          order?: {
            entity?: { id?: string; notes?: { routepulseOrderId?: string } };
          };
        };
      };
      const entity = body.payload?.payment?.entity;
      const providerOrder = entity?.order_id || body.payload?.order?.entity?.id;
      const localId =
        entity?.notes?.routepulseOrderId ||
        body.payload?.order?.entity?.notes?.routepulseOrderId ||
        (providerOrder ? orderIdForRazorpayOrder(providerOrder) : undefined);
      if (localId) {
        const order = orders.find((o) => o.id === localId);
        if (
          order &&
          ["payment.captured", "order.paid"].includes(body.event || "") &&
          order.paymentStatus !== "paid"
        ) {
          const snapshot = structuredClone(order);
          order.paymentStatus = "paid";
          order.updatedAt = new Date().toISOString();
          try {
            await persistOrder(order);
          } catch (error) {
            restore(order, snapshot);
            throw error;
          }
          await notifySafely(order, "payment_received");
        }
      }
      return res.status(200).json({ received: true });
    } catch (error) {
      if (error instanceof SyntaxError)
        return res.status(400).json({ error: "Invalid webhook payload" });
      throw error;
    }
  });
  app.post("/api/webhooks/clerk", async (req, res, next) => {
    try {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
      return res.json(
        await syncClerkWebhook(raw, {
          "svix-id": req.header("svix-id") || undefined,
          "svix-timestamp": req.header("svix-timestamp") || undefined,
          "svix-signature": req.header("svix-signature") || undefined,
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  app.use("/api", authenticate);
  app.get("/api/me", (req, res) => res.json(req.user));
  app.get("/api/orders", (req, res) => {
    let data = store.listOrders(req.user!.organizationId);
    if (req.user!.role === "driver") {
      const driver = drivers.find((d) => d.userId === req.user!.id);
      data = data.filter((o) => o.assignedDriverId === driver?.id);
    }
    if (req.user!.role === "customer")
      data = data.filter((o) => o.customerEmail === req.user!.email);
    const status = req.query.status;
    if (typeof status === "string")
      data = data.filter((o) => o.status === status);
    return res.json(data.map(etaFor));
  });
  app.post(
    "/api/orders",
    permit("admin", "dispatcher"),
    async (req, res, next) => {
      let order: Order | undefined;
      try {
        const parsed = createSchema.parse(req.body);
        const { recipientPin, ...input } = parsed;
        order = store.createOrder(input, req.user!);
        store.setDeliveryPin(order.id, recipientPin);
        await persistOrder(order);
        await audit(req.user!, "order.created", "order", order.id, {
          trackingCode: order.trackingCode,
        });
        await notifySafely(order, "order_created");
        return res.status(201).json(etaFor(order));
      } catch (e) {
        if (order) {
          const index = orders.indexOf(order);
          if (index >= 0) orders.splice(index, 1);
        }
        next(e);
      }
    },
  );
  app.get("/api/orders/:id", (req, res) => {
    const order = store.getOrder(req.params.id, req.user!.organizationId);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!canAccessOrder(req.user!, order))
      return res.status(403).json({ error: "Not your order" });
    if (req.user!.role === "driver") {
      const d = drivers.find((x) => x.userId === req.user!.id);
      if (order.assignedDriverId !== d?.id)
        return res.status(403).json({ error: "Not your assignment" });
    }
    return res.json(etaFor(order));
  });
  app.patch(
    "/api/customer/orders/:id/reschedule",
    permit("customer"),
    async (req, res, next) => {
      try {
        const body = z
          .object({
            deliveryWindowStart: z.iso.datetime(),
            promisedAt: z.iso.datetime(),
            deliveryNotes: z.string().max(500).optional(),
          })
          .refine((value) => value.deliveryWindowStart < value.promisedAt, {
            message: "Delivery window must start before its end",
          })
          .parse(req.body);
        const order = store.getOrder(req.params.id, req.user!.organizationId);
        if (!order || !canAccessOrder(req.user!, order))
          return res.status(404).json({ error: "Delivery not found" });
        if (!["pending", "assigned", "in_transit"].includes(order.status))
          return res
            .status(409)
            .json({ error: "This delivery can no longer be rescheduled" });
        const snapshot = structuredClone(order);
        order.deliveryWindowStart = body.deliveryWindowStart;
        order.promisedAt = body.promisedAt;
        if (body.deliveryNotes !== undefined)
          order.deliveryNotes = body.deliveryNotes;
        order.rescheduleCount = (order.rescheduleCount || 0) + 1;
        order.updatedAt = new Date().toISOString();
        order.events.push({
          id: crypto.randomUUID(),
          type: "rescheduled",
          message: "Customer rescheduled the delivery window",
          actorId: req.user!.id,
          createdAt: order.updatedAt,
        });
        try {
          await persistOrder(order);
        } catch (error) {
          restore(order, snapshot);
          throw error;
        }
        await audit(
          req.user!,
          "customer.order_rescheduled",
          "order",
          order.id,
          {
            deliveryWindowStart: body.deliveryWindowStart,
            promisedAt: body.promisedAt,
          },
        );
        await notifySafely(order, "delivery_rescheduled");
        req.app
          .get("io")
          ?.to(`tenant:${order.organizationId}`)
          .emit("order:updated", order);
        req.app
          .get("io")
          ?.to(`track:${order.trackingCode}`)
          .emit("order:updated", order);
        return res.json(etaFor(order));
      } catch (e) {
        next(e);
      }
    },
  );
  app.post(
    "/api/customer/orders/:id/cancel",
    permit("customer"),
    async (req, res, next) => {
      try {
        const order = store.getOrder(req.params.id, req.user!.organizationId);
        if (!order || !canAccessOrder(req.user!, order))
          return res.status(404).json({ error: "Delivery not found" });
        if (!["pending", "assigned"].includes(order.status))
          return res
            .status(409)
            .json({
              error: "Only pending or assigned deliveries can be cancelled",
            });
        const driver = drivers.find(
          (item) => item.id === order.assignedDriverId,
        );
        const orderSnapshot = structuredClone(order);
        const driverSnapshot = driver ? structuredClone(driver) : undefined;
        store.transition(order, "cancelled", req.user!);
        order.cancelledAt = order.updatedAt;
        try {
          if (driver && driverSnapshot)
            await persistOrderAndDriver(order, driver);
          else await persistOrder(order);
        } catch (error) {
          restore(order, orderSnapshot);
          if (driver && driverSnapshot) restore(driver, driverSnapshot);
          throw error;
        }
        await audit(req.user!, "customer.order_cancelled", "order", order.id);
        await notifySafely(order, "order_cancelled");
        req.app
          .get("io")
          ?.to(`tenant:${order.organizationId}`)
          .emit("order:updated", order);
        req.app
          .get("io")
          ?.to(`track:${order.trackingCode}`)
          .emit("order:updated", order);
        return res.json(order);
      } catch (e) {
        next(e);
      }
    },
  );
  app.patch(
    "/api/orders/:id/status",
    permit("admin", "dispatcher", "driver"),
    async (req, res, next) => {
      try {
        const { status } = statusSchema.parse(req.body);
        if (status === "delivered")
          return res.status(409).json({
            error: "Use proof of delivery to complete an in-transit order",
          });
        const order = store.getOrder(req.params.id, req.user!.organizationId);
        if (!order) return res.status(404).json({ error: "Order not found" });
        if (req.user!.role === "driver") {
          const d = drivers.find((x) => x.userId === req.user!.id);
          if (order.assignedDriverId !== d?.id)
            return res.status(403).json({ error: "Not your assignment" });
        }
        const driver = drivers.find((x) => x.id === order.assignedDriverId);
        const orderSnapshot = structuredClone(order),
          driverSnapshot = driver ? structuredClone(driver) : undefined;
        try {
          store.transition(order, status, req.user!);
          if (driver && driver.status !== driverSnapshot?.status)
            await persistOrderAndDriver(order, driver);
          else await persistOrder(order);
        } catch (error) {
          restore(order, orderSnapshot);
          if (driver && driverSnapshot) restore(driver, driverSnapshot);
          throw error;
        }
        await audit(req.user!, "order.status_updated", "order", order.id, {
          status,
        });
        await notifySafely(order, `order_${status}`);
        req.app
          .get("io")
          ?.to(`tenant:${req.user!.organizationId}`)
          .emit("order:updated", order);
        req.app
          .get("io")
          ?.to(`track:${order.trackingCode}`)
          .emit("order:updated", order);
        return res.json(etaFor(order));
      } catch (e) {
        next(e);
      }
    },
  );
  app.post(
    "/api/orders/:id/assign",
    permit("admin", "dispatcher"),
    async (req, res, next) => {
      try {
        const order = store.getOrder(req.params.id, req.user!.organizationId);
        if (!order) return res.status(404).json({ error: "Order not found" });
        const eligible = drivers.filter(
          (d) =>
            driverForTenant(d, req.user!.organizationId) &&
            d.status === "available" &&
            d.capacityKg >= order.packageWeightKg,
        );
        const driver = req.body.driverId
          ? eligible.find((d) => d.id === req.body.driverId)
          : eligible.sort(
              (a, b) =>
                haversineKm(a.location, order.pickup) -
                haversineKm(b.location, order.pickup),
            )[0];
        if (!driver)
          return res
            .status(422)
            .json({ error: "No eligible available driver" });
        const orderSnapshot = structuredClone(order),
          driverSnapshot = structuredClone(driver);
        try {
          store.assign(order, driver, req.user!);
          await persistOrderAndDriver(order, driver);
        } catch (error) {
          restore(order, orderSnapshot);
          restore(driver, driverSnapshot);
          throw error;
        }
        await audit(req.user!, "order.assigned", "order", order.id, {
          driverId: driver.id,
        });
        await notifySafely(order, "driver_assigned");
        req.app
          .get("io")
          ?.to(`tenant:${req.user!.organizationId}`)
          .emit("order:updated", order);
        return res.json(etaFor(order));
      } catch (e) {
        next(e);
      }
    },
  );
  app.post(
    "/api/orders/:id/accept",
    permit("driver"),
    async (req, res, next) => {
      try {
        const order = store.getOrder(req.params.id, req.user!.organizationId);
        const driver = drivers.find((item) => item.userId === req.user!.id);
        if (!order || !driver || order.assignedDriverId !== driver.id)
          return res.status(404).json({ error: "Assignment not found" });
        if (order.status !== "assigned")
          return res
            .status(409)
            .json({ error: "Only assigned deliveries can be accepted" });
        if (!order.events.some((item) => item.type === "accepted"))
          order.events.push({
            id: crypto.randomUUID(),
            type: "accepted",
            message: `Accepted by ${driver.name}`,
            actorId: req.user!.id,
            createdAt: new Date().toISOString(),
          });
        order.updatedAt = new Date().toISOString();
        await persistOrder(order);
        await audit(req.user!, "order.accepted", "order", order.id);
        return res.json(etaFor(order));
      } catch (e) {
        next(e);
      }
    },
  );
  app.post(
    "/api/orders/:id/reject",
    permit("driver"),
    async (req, res, next) => {
      try {
        const body = z
          .object({ reason: z.string().min(3).max(300) })
          .parse(req.body);
        const order = store.getOrder(req.params.id, req.user!.organizationId);
        const driver = drivers.find((item) => item.userId === req.user!.id);
        if (!order || !driver || order.assignedDriverId !== driver.id)
          return res.status(404).json({ error: "Assignment not found" });
        if (order.status !== "assigned")
          return res
            .status(409)
            .json({ error: "Only assigned deliveries can be rejected" });
        const os = structuredClone(order),
          ds = structuredClone(driver);
        order.assignedDriverId = undefined;
        order.status = "pending";
        order.updatedAt = new Date().toISOString();
        order.events.push({
          id: crypto.randomUUID(),
          type: "rejected",
          message: `Driver declined: ${body.reason}`,
          actorId: req.user!.id,
          createdAt: order.updatedAt,
        });
        driver.status = "available";
        try {
          await persistOrderAndDriver(order, driver);
        } catch (error) {
          restore(order, os);
          restore(driver, ds);
          throw error;
        }
        await audit(req.user!, "order.rejected", "order", order.id, {
          reason: body.reason,
        });
        return res.json(etaFor(order));
      } catch (e) {
        next(e);
      }
    },
  );
  app.post(
    "/api/orders/:id/proof",
    permit("driver"),
    async (req, res, next) => {
      try {
        const body = z
          .object({
            recipientName: z.string().min(2).max(80),
            recipientPin: z.string().regex(/^\d{4,6}$/),
            signatureData: z.string().min(10).max(20_000),
          })
          .parse(req.body);
        const order = store.getOrder(req.params.id, req.user!.organizationId);
        const driver = drivers.find((item) => item.userId === req.user!.id);
        if (!order || !driver || order.assignedDriverId !== driver.id)
          return res.status(404).json({ error: "Assignment not found" });
        if (order.status !== "in_transit")
          return res.status(409).json({ error: "Delivery must be in transit" });
        if (!store.verifyDeliveryPin(order.id, body.recipientPin))
          return res.status(400).json({ error: "Incorrect recipient PIN" });
        const os = structuredClone(order),
          ds = structuredClone(driver);
        const proof = {
          recipientName: body.recipientName,
          signatureData: body.signatureData,
          driverId: driver.id,
          createdAt: new Date().toISOString(),
        };
        order.proof = proof;
        store.transition(order, "delivered", req.user!);
        try {
          await persistProofAndDelivery(order, driver, proof);
        } catch (error) {
          restore(order, os);
          restore(driver, ds);
          throw error;
        }
        await audit(req.user!, "delivery.proof_recorded", "order", order.id, {
          recipientName: body.recipientName,
        });
        await notifySafely(order, "order_delivered");
        req.app
          .get("io")
          ?.to(`tenant:${req.user!.organizationId}`)
          .emit("order:updated", order);
        req.app
          .get("io")
          ?.to(`track:${order.trackingCode}`)
          .emit("order:updated", order);
        return res.json(order);
      } catch (e) {
        next(e);
      }
    },
  );
  app.get("/api/drivers", permit("admin", "dispatcher"), (req, res) =>
    res.json(
      drivers.filter((driver) =>
        driverForTenant(driver, req.user!.organizationId),
      ),
    ),
  );
  app.patch(
    "/api/drivers/:id",
    permit("admin", "dispatcher"),
    async (req, res, next) => {
      try {
        const body = z
          .object({
            status: z.enum(["available", "busy", "offline"]).optional(),
            capacityKg: z.number().positive().max(5000).optional(),
            shiftStart: z
              .string()
              .regex(/^\d{2}:\d{2}$/)
              .optional(),
            shiftEnd: z
              .string()
              .regex(/^\d{2}:\d{2}$/)
              .optional(),
            vehiclePlate: z.string().trim().max(32).optional(),
            maintenanceDueAt: z.iso.datetime().nullable().optional(),
            maintenanceStatus: z.enum(["ok", "due", "overdue"]).optional(),
          })
          .refine(
            (value) =>
              value.status ||
              value.capacityKg ||
              value.shiftStart ||
              value.shiftEnd ||
              value.vehiclePlate !== undefined ||
              value.maintenanceDueAt !== undefined ||
              value.maintenanceStatus,
            {
              message: "No driver changes supplied",
            },
          )
          .parse(req.body);
        const driver = drivers.find(
          (item) =>
            item.id === req.params.id &&
            driverForTenant(item, req.user!.organizationId),
        );
        if (!driver) return res.status(404).json({ error: "Driver not found" });
        Object.assign(driver, body);
        driver.lastSeenAt = new Date().toISOString();
        await persistDriver(driver);
        await audit(req.user!, "driver.updated", "driver", driver.id, body);
        return res.json(driver);
      } catch (e) {
        next(e);
      }
    },
  );
  app.get("/api/orders/:id/scans", async (req, res, next) => {
    try {
      const order = store.getOrder(req.params.id, req.user!.organizationId);
      if (!order || !canAccessOrder(req.user!, order))
        return res.status(404).json({ error: "Delivery not found" });
      if (req.user!.role === "driver") {
        const driver = drivers.find((item) => item.userId === req.user!.id);
        if (order.assignedDriverId !== driver?.id)
          return res.status(403).json({ error: "Not your assignment" });
      }
      return res.json(
        parcelScans.filter(
          (scan) =>
            scan.orderId === order.id &&
            scan.organizationId === req.user!.organizationId,
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.post(
    "/api/orders/:id/scans",
    permit("admin", "dispatcher", "driver"),
    async (req, res, next) => {
      try {
        const body = parcelScanSchema.parse(req.body);
        const order = store.getOrder(req.params.id, req.user!.organizationId);
        if (!order) return res.status(404).json({ error: "Order not found" });
        if (req.user!.role === "driver") {
          const driver = drivers.find((item) => item.userId === req.user!.id);
          if (order.assignedDriverId !== driver?.id)
            return res.status(403).json({ error: "Not your assignment" });
        }
        const expected = [order.parcelCode, order.trackingCode]
          .filter(Boolean)
          .map((code) => code!.toLowerCase());
        if (!expected.includes(body.parcelCode.toLowerCase()))
          return res
            .status(400)
            .json({ error: "Parcel code does not match this order" });
        const existing = parcelScans.find(
          (scan) => scan.orderId === order.id && scan.stage === body.stage,
        );
        if (existing) return res.json(existing);
        const scan: ParcelScan = {
          id: crypto.randomUUID(),
          organizationId: order.organizationId,
          orderId: order.id,
          parcelCode: order.parcelCode || body.parcelCode,
          stage: body.stage as ParcelScanStage,
          scannedBy: req.user!.id,
          scannedAt: new Date().toISOString(),
        };
        const orderSnapshot = structuredClone(order);
        parcelScans.unshift(scan);
        order.updatedAt = scan.scannedAt;
        order.events.push({
          id: crypto.randomUUID(),
          type: `parcel_scanned_${scan.stage}`,
          message: `Parcel scanned at ${scan.stage}`,
          actorId: req.user!.id,
          createdAt: scan.scannedAt,
        });
        try {
          await persistParcelScanAndOrder(scan, order);
        } catch (error) {
          const index = parcelScans.indexOf(scan);
          if (index >= 0) parcelScans.splice(index, 1);
          restore(order, orderSnapshot);
          throw error;
        }
        await audit(req.user!, "parcel.scanned", "order", order.id, {
          stage: scan.stage,
          parcelCode: scan.parcelCode,
        });
        req.app
          .get("io")
          ?.to(`tenant:${order.organizationId}`)
          .emit("order:updated", order);
        return res.status(201).json(scan);
      } catch (e) {
        next(e);
      }
    },
  );
  app.get(
    "/api/exceptions",
    permit("admin", "dispatcher", "driver"),
    (req, res) =>
      res.json(
        deliveryExceptions.filter(
          (item) => item.organizationId === req.user!.organizationId,
        ),
      ),
  );
  app.post(
    "/api/orders/:id/exceptions",
    permit("admin", "dispatcher", "driver"),
    async (req, res, next) => {
      try {
        const body = z
          .object({
            type: z.enum([
              "delay",
              "address_issue",
              "customer_unavailable",
              "vehicle_issue",
              "package_issue",
              "delivery_failed",
            ]),
            description: z.string().min(3).max(500),
          })
          .parse(req.body);
        const order = store.getOrder(req.params.id, req.user!.organizationId);
        if (!order) return res.status(404).json({ error: "Order not found" });
        if (req.user!.role === "driver") {
          const driver = drivers.find((item) => item.userId === req.user!.id);
          if (order.assignedDriverId !== driver?.id)
            return res.status(403).json({ error: "Not your assignment" });
        }
        const item: DeliveryException = {
          id: crypto.randomUUID(),
          organizationId: req.user!.organizationId,
          orderId: order.id,
          ...body,
          status: "open",
          createdBy: req.user!.id,
          createdAt: new Date().toISOString(),
        };
        deliveryExceptions.unshift(item);
        order.events.push({
          id: crypto.randomUUID(),
          type: "exception",
          message: `${body.type.replaceAll("_", " ")}: ${body.description}`,
          actorId: req.user!.id,
          createdAt: item.createdAt,
        });
        order.updatedAt = item.createdAt;
        await persistExceptionAndOrder(item, order);
        await audit(req.user!, "exception.created", "exception", item.id, {
          orderId: order.id,
          type: body.type,
        });
        req.app
          .get("io")
          ?.to(`tenant:${req.user!.organizationId}`)
          .emit("order:updated", order);
        return res.status(201).json(item);
      } catch (e) {
        next(e);
      }
    },
  );
  app.patch(
    "/api/exceptions/:id/resolve",
    permit("admin", "dispatcher"),
    async (req, res, next) => {
      try {
        const { resolution } = z
          .object({ resolution: z.string().min(3).max(500) })
          .parse(req.body);
        const item = deliveryExceptions.find(
          (value) =>
            value.id === req.params.id &&
            value.organizationId === req.user!.organizationId,
        );
        if (!item)
          return res.status(404).json({ error: "Exception not found" });
        item.status = "resolved";
        item.resolution = resolution;
        item.resolvedAt = new Date().toISOString();
        await persistException(item);
        await audit(req.user!, "exception.resolved", "exception", item.id);
        return res.json(item);
      } catch (e) {
        next(e);
      }
    },
  );
  app.get("/api/notifications", (req, res) =>
    res.json(
      notificationRecords
        .filter(
          (item) =>
            item.organizationId === req.user!.organizationId &&
            (!item.userId || item.userId === req.user!.id),
        )
        .slice(0, 100),
    ),
  );
  app.patch("/api/notifications/:id/read", async (req, res, next) => {
    try {
      const item = notificationRecords.find(
        (value) =>
          value.id === req.params.id &&
          value.organizationId === req.user!.organizationId &&
          (!value.userId || value.userId === req.user!.id),
      );
      if (!item)
        return res.status(404).json({ error: "Notification not found" });
      item.readAt = new Date().toISOString();
      await persistNotification(item);
      return res.json(item);
    } catch (e) {
      next(e);
    }
  });
  app.get(
    "/api/reports/orders.csv",
    permit("admin", "dispatcher", "driver", "customer"),
    (req, res) => {
      let data = store.listOrders(req.user!.organizationId);
      if (req.user!.role === "customer")
        data = data.filter((order) => canAccessOrder(req.user!, order));
      if (req.user!.role === "driver") {
        const driver = drivers.find((item) => item.userId === req.user!.id);
        data = data.filter((order) => order.assignedDriverId === driver?.id);
      }
      const status =
        typeof req.query.status === "string" ? req.query.status : "";
      const from =
        typeof req.query.from === "string" ? Date.parse(req.query.from) : NaN;
      const to =
        typeof req.query.to === "string" ? Date.parse(req.query.to) : NaN;
      if (status) data = data.filter((order) => order.status === status);
      if (Number.isFinite(from))
        data = data.filter((order) => Date.parse(order.createdAt) >= from);
      if (Number.isFinite(to))
        data = data.filter((order) => Date.parse(order.createdAt) <= to);
      const lines = [
        csvRow([
          "tracking_code",
          "parcel_code",
          "customer",
          "destination",
          "status",
          "priority",
          "amount",
          "payment_status",
          "eta",
          "created_at",
        ]),
        ...data.map((order) =>
          csvRow([
            order.trackingCode,
            order.parcelCode,
            order.customerName,
            order.dropoff.label,
            order.status,
            order.priority,
            order.amount,
            order.paymentStatus,
            etaFor(order).estimatedArrivalAt,
            order.createdAt,
          ]),
        ),
      ];
      res
        .type("text/csv")
        .setHeader(
          "Content-Disposition",
          "attachment; filename=routepulse-orders.csv",
        )
        .send(lines.join("\n"));
    },
  );
  app.get(
    "/api/reports/summary.csv",
    permit("admin", "dispatcher"),
    (req, res) => {
      const summary = store.summary(req.user!.organizationId);
      const lines = [
        csvRow(["metric", "value"]),
        csvRow(["active_drivers", summary.activeDrivers]),
        csvRow(["deliveries_today", summary.deliveriesToday]),
        csvRow(["on_time_rate", `${summary.onTimeRate}%`]),
        csvRow(["revenue", summary.revenue]),
        csvRow(["average_delivery_minutes", summary.averageDeliveryMinutes]),
        ...Object.entries(summary.statusCounts).map(([key, value]) =>
          csvRow([`status_${key}`, value]),
        ),
      ];
      res
        .type("text/csv")
        .setHeader(
          "Content-Disposition",
          "attachment; filename=routepulse-summary.csv",
        )
        .send(lines.join("\n"));
    },
  );
  app.get("/api/support/tickets", (req, res) =>
    res.json(
      supportTickets.filter(
        (ticket) =>
          ticket.organizationId === req.user!.organizationId &&
          canAccessTicket(req.user!, ticket),
      ),
    ),
  );
  app.post("/api/support/tickets", async (req, res, next) => {
    try {
      const body = supportTicketSchema.parse(req.body);
      let order: Order | undefined;
      if (body.orderId) {
        order = store.getOrder(body.orderId, req.user!.organizationId);
        if (
          !order ||
          (req.user!.role === "customer" && !canAccessOrder(req.user!, order))
        )
          return res.status(404).json({ error: "Order not found" });
      }
      const now = new Date().toISOString();
      const ticket: SupportTicket = {
        id: crypto.randomUUID(),
        organizationId: req.user!.organizationId,
        orderId: order?.id,
        customerId: req.user!.role === "customer" ? req.user!.id : undefined,
        subject: body.subject,
        category: body.category,
        priority: body.priority,
        status: "open",
        createdBy: req.user!.id,
        createdAt: now,
        updatedAt: now,
        lastMessage: body.message,
      };
      const message: SupportMessage = {
        id: crypto.randomUUID(),
        ticketId: ticket.id,
        organizationId: ticket.organizationId,
        senderId: req.user!.id,
        senderName: req.user!.name,
        senderRole: req.user!.role,
        message: body.message,
        internal: false,
        createdAt: now,
      };
      supportTickets.unshift(ticket);
      supportMessages.push(message);
      try {
        await persistSupportTicketWithMessage(ticket, message);
      } catch (error) {
        supportTickets.splice(supportTickets.indexOf(ticket), 1);
        supportMessages.splice(supportMessages.indexOf(message), 1);
        throw error;
      }
      await audit(
        req.user!,
        "support.ticket_created",
        "support_ticket",
        ticket.id,
        {
          orderId: ticket.orderId,
        },
      );
      req.app
        .get("io")
        ?.to(`tenant:${ticket.organizationId}`)
        .emit("support:ticket.updated", ticket);
      req.app
        .get("io")
        ?.to(`support:${ticket.id}`)
        .emit("support:ticket.updated", ticket);
      return res.status(201).json(ticket);
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/support/tickets/:id/messages", (req, res) => {
    const ticket = supportTickets.find(
      (value) =>
        value.id === req.params.id &&
        value.organizationId === req.user!.organizationId,
    );
    if (!ticket || !canAccessTicket(req.user!, ticket))
      return res.status(404).json({ error: "Support ticket not found" });
    return res.json(
      supportMessages.filter(
        (message) =>
          message.ticketId === ticket.id &&
          (req.user!.role !== "customer" || !message.internal),
      ),
    );
  });
  app.post("/api/support/tickets/:id/messages", async (req, res, next) => {
    try {
      const body = supportMessageSchema.parse(req.body);
      const ticket = supportTickets.find(
        (value) =>
          value.id === req.params.id &&
          value.organizationId === req.user!.organizationId,
      );
      if (!ticket || !canAccessTicket(req.user!, ticket))
        return res.status(404).json({ error: "Support ticket not found" });
      const now = new Date().toISOString();
      const message: SupportMessage = {
        id: crypto.randomUUID(),
        ticketId: ticket.id,
        organizationId: ticket.organizationId,
        senderId: req.user!.id,
        senderName: req.user!.name,
        senderRole: req.user!.role,
        message: body.message,
        internal: req.user!.role === "customer" ? false : body.internal,
        createdAt: now,
      };
      const ticketSnapshot = structuredClone(ticket);
      ticket.lastMessage = message.message;
      ticket.updatedAt = now;
      if (ticket.status === "resolved") ticket.status = "open";
      supportMessages.push(message);
      try {
        await persistSupportTicket(ticket);
        await persistSupportMessage(message);
      } catch (error) {
        restore(ticket, ticketSnapshot);
        supportMessages.splice(supportMessages.indexOf(message), 1);
        throw error;
      }
      req.app
        .get("io")
        ?.to(`tenant:${ticket.organizationId}`)
        .emit("support:message", message);
      req.app
        .get("io")
        ?.to(`support:${ticket.id}`)
        .emit("support:message", message);
      return res.status(201).json(message);
    } catch (e) {
      next(e);
    }
  });
  app.patch(
    "/api/support/tickets/:id",
    permit("admin", "dispatcher"),
    async (req, res, next) => {
      try {
        const body = z
          .object({
            status: z.enum(["open", "pending", "resolved"]).optional(),
            assignedTo: z.string().optional().nullable(),
          })
          .refine((value) => value.status || value.assignedTo !== undefined, {
            message: "No ticket changes supplied",
          })
          .parse(req.body);
        const ticket = supportTickets.find(
          (value) =>
            value.id === req.params.id &&
            value.organizationId === req.user!.organizationId,
        );
        if (!ticket)
          return res.status(404).json({ error: "Support ticket not found" });
        const snapshot = structuredClone(ticket);
        if (body.status) ticket.status = body.status;
        if (body.assignedTo !== undefined)
          ticket.assignedTo = body.assignedTo || undefined;
        ticket.updatedAt = new Date().toISOString();
        try {
          await persistSupportTicket(ticket);
        } catch (error) {
          restore(ticket, snapshot);
          throw error;
        }
        await audit(
          req.user!,
          "support.ticket_updated",
          "support_ticket",
          ticket.id,
          body,
        );
        req.app
          .get("io")
          ?.to(`tenant:${ticket.organizationId}`)
          .emit("support:ticket.updated", ticket);
        req.app
          .get("io")
          ?.to(`support:${ticket.id}`)
          .emit("support:ticket.updated", ticket);
        return res.json(ticket);
      } catch (e) {
        next(e);
      }
    },
  );
  app.get("/api/admin/users", permit("admin"), (req, res) =>
    res.json(
      users.filter((user) => user.organizationId === req.user!.organizationId),
    ),
  );
  app.patch(
    "/api/admin/users/:id/role",
    permit("admin"),
    async (req, res, next) => {
      try {
        const { role } = z
          .object({
            role: z.enum(["admin", "dispatcher", "driver", "customer"]),
          })
          .parse(req.body);
        const user = users.find(
          (item) =>
            item.id === req.params.id &&
            item.organizationId === req.user!.organizationId,
        );
        if (!user) return res.status(404).json({ error: "User not found" });
        if (user.id === req.user!.id && role !== "admin")
          return res
            .status(409)
            .json({ error: "You cannot remove your own admin access" });
        const previousRole = user.role;
        user.role = role as Role;
        try {
          await persistUserRole(user.id, user.role);
        } catch (error) {
          user.role = previousRole;
          throw error;
        }
        await audit(req.user!, "user.role_updated", "user", user.id, { role });
        return res.json(user);
      } catch (e) {
        next(e);
      }
    },
  );
  app.get("/api/admin/audit", permit("admin"), (req, res) =>
    res.json(
      auditRecords
        .filter((item) => item.organizationId === req.user!.organizationId)
        .slice(0, 200),
    ),
  );
  app.get("/api/settings", permit("admin", "dispatcher"), (req, res) =>
    res.json(organizationSettings),
  );
  app.put("/api/settings", permit("admin"), async (req, res, next) => {
    try {
      const body = z
        .object({
          name: z.string().min(2).max(80),
          timezone: z.string().min(3).max(80),
          geofenceRadiusMeters: z.number().int().min(50).max(1000),
          averageSpeedKph: z.number().min(5).max(120),
          notificationsEnabled: z.boolean(),
        })
        .parse(req.body);
      const snapshot = structuredClone(organizationSettings);
      Object.assign(organizationSettings, body);
      try {
        await persistSettings(organizationSettings);
      } catch (error) {
        restore(organizationSettings, snapshot);
        throw error;
      }
      await audit(
        req.user!,
        "organization.settings_updated",
        "organization",
        organizationSettings.organizationId,
        body,
      );
      return res.json(organizationSettings);
    } catch (e) {
      next(e);
    }
  });
  app.post(
    "/api/routes/optimize",
    permit("admin", "dispatcher"),
    (req, res, next) => {
      try {
        const body = z
          .object({
            driverId: z.string(),
            orderIds: z.array(z.string()).min(1).max(50),
          })
          .parse(req.body);
        const driver = drivers.find(
          (d) =>
            d.id === body.driverId &&
            driverForTenant(d, req.user!.organizationId),
        );
        if (!driver) return res.status(404).json({ error: "Driver not found" });
        const selected = body.orderIds
          .map((id) => store.getOrder(id, req.user!.organizationId))
          .filter(Boolean);
        if (selected.length !== body.orderIds.length)
          return res
            .status(404)
            .json({ error: "One or more orders not found" });
        return res.json(
          optimizeRoute(
            driver.location,
            selected.map((o) => ({
              ...o!.dropoff,
              id: o!.id,
              demandKg: o!.packageWeightKg,
            })),
            driver.capacityKg,
          ),
        );
      } catch (e) {
        next(e);
      }
    },
  );
  app.post(
    "/api/payments/:orderId/checkout",
    permit("admin", "dispatcher", "customer"),
    async (req, res, next) => {
      try {
        const order = store.getOrder(
          req.params.orderId,
          req.user!.organizationId,
        );
        if (!order) return res.status(404).json({ error: "Order not found" });
        if (!canAccessOrder(req.user!, order))
          return res.status(403).json({ error: "Not your order" });
        return res.json(await createCheckout(order));
      } catch (e) {
        next(e);
      }
    },
  );
  app.post(
    "/api/payments/:orderId/verify",
    permit("admin", "dispatcher", "customer"),
    async (req, res, next) => {
      try {
        const order = store.getOrder(
          req.params.orderId,
          req.user!.organizationId,
        );
        if (!order) return res.status(404).json({ error: "Order not found" });
        if (!canAccessOrder(req.user!, order))
          return res.status(403).json({ error: "Not your order" });
        if (order.paymentStatus === "paid") return res.json(order);
        const input = z
          .object({
            razorpayOrderId: z.string(),
            razorpayPaymentId: z.string(),
            razorpaySignature: z.string(),
          })
          .parse(req.body);
        if (
          !verifyRazorpayPayment(
            order.id,
            input.razorpayOrderId,
            input.razorpayPaymentId,
            input.razorpaySignature,
          )
        )
          return res.status(400).json({ error: "Payment verification failed" });
        const snapshot = structuredClone(order);
        order.paymentStatus = "paid";
        order.updatedAt = new Date().toISOString();
        order.events.push({
          id: crypto.randomUUID(),
          type: "payment",
          message: "Razorpay payment verified",
          actorId: req.user!.id,
          createdAt: order.updatedAt,
        });
        try {
          await persistOrder(order);
        } catch (error) {
          restore(order, snapshot);
          throw error;
        }
        await notifySafely(order, "payment_received");
        return res.json(order);
      } catch (e) {
        next(e);
      }
    },
  );
  app.post(
    "/api/payments/demo/:orderId/confirm",
    permit("admin", "dispatcher", "customer"),
    async (req, res, next) => {
      try {
        if (paymentMode() !== "demo")
          return res.status(404).json({ error: "Demo payment disabled" });
        const order = store.getOrder(
          req.params.orderId,
          req.user!.organizationId,
        );
        if (!order) return res.status(404).json({ error: "Order not found" });
        if (!canAccessOrder(req.user!, order))
          return res.status(403).json({ error: "Not your order" });
        if (order.paymentStatus === "paid") return res.json(order);
        const snapshot = structuredClone(order);
        order.paymentStatus = "paid";
        order.updatedAt = new Date().toISOString();
        order.events.push({
          id: crypto.randomUUID(),
          type: "payment",
          message: "Payment confirmed by demo adapter",
          actorId: req.user!.id,
          createdAt: order.updatedAt,
        });
        try {
          await persistOrder(order);
        } catch (error) {
          restore(order, snapshot);
          throw error;
        }
        await notifySafely(order, "payment_received");
        return res.json(order);
      } catch (e) {
        next(e);
      }
    },
  );
  app.get("/api/analytics/summary", permit("admin", "dispatcher"), (req, res) =>
    res.json(store.summary(req.user!.organizationId)),
  );
  app.use((_req, res) => res.status(404).json({ error: "Route not found" }));
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof z.ZodError)
        return res
          .status(400)
          .json({ error: "Validation failed", details: err.issues });
      const e = err as Error & { status?: number };
      return res
        .status(e.status || 500)
        .json({ error: e.status ? e.message : "Internal server error" });
    },
  );
  return app;
}
