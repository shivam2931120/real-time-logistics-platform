import type { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { verifyToken } from "@clerk/backend";
import {
  drivers,
  orders,
  organizationSettings,
  supportTickets,
  users,
} from "../domain/store.js";
import { persistDriver, persistDriverLocation, persistOrder } from "../db/persistence.js";
import { resolveClerkUser } from "../services/clerkIdentity.js";
import { geofenceTransitions } from "../services/geofence.js";

export function configureSockets(io: Server) {
  io.use((socket, next) => {
    const trackingCode = String(socket.handshake.auth.trackingCode || "");
    if (
      trackingCode &&
      orders.some(
        (order) =>
          order.trackingCode.toLowerCase() === trackingCode.toLowerCase(),
      )
    ) {
      socket.data.publicTrackingCode = trackingCode.toUpperCase();
      return next();
    }
    const token = String(socket.handshake.auth.token || "");
    if (process.env.AUTH_MODE === "clerk") {
      void verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY })
        .then(resolveClerkUser)
        .then((user) => {
          socket.data.user = user;
          next();
        })
        .catch(() => next(new Error("unauthorized")));
      return;
    }
    try {
      const c = jwt.verify(
        token,
        process.env.JWT_SECRET || "routepulse-local-development-only",
        { issuer: "routepulse", audience: "routepulse-web" },
      ) as jwt.JwtPayload;
      const user = users.find((u) => u.id === c.sub);
      if (!user) throw new Error();
      socket.data.user = user;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });
  io.on("connection", (socket) => {
    if (socket.data.publicTrackingCode) {
      socket.join(`track:${socket.data.publicTrackingCode}`);
      return;
    }
    const user = socket.data.user;
    socket.join(`tenant:${user.organizationId}`);
    socket.on("order:subscribe", (code: string, ack?: Function) => {
      const order = orders.find(
        (o) =>
          o.trackingCode === code && o.organizationId === user.organizationId,
      );
      if (!order) return ack?.({ error: "Not found" });
      socket.join(`track:${code}`);
      ack?.({ ok: true });
    });
    socket.on("support:subscribe", (ticketId: string, ack?: Function) => {
      const ticket = supportTickets.find(
        (item) =>
          item.id === ticketId &&
          item.organizationId === user.organizationId &&
          (user.role !== "customer" ||
            item.customerId === user.id ||
            item.createdBy === user.id),
      );
      if (!ticket) return ack?.({ error: "Not found" });
      socket.join(`support:${ticket.id}`);
      ack?.({ ok: true });
    });
    let last = 0;
    socket.on("location:update", (raw: unknown, ack?: Function) => {
      const now = Date.now();
      if (now - last < 1000) return ack?.({ error: "Update rate exceeded" });
      last = now;
      const p = raw as { lat?: number; lng?: number; accuracy?: number; source?: string };
      if (
        typeof p.lat !== "number" ||
        typeof p.lng !== "number" ||
        Math.abs(p.lat) > 90 ||
        Math.abs(p.lng) > 180
      )
        return ack?.({ error: "Invalid coordinates" });
      let d = drivers.find((x) => x.userId === user.id);
      if (!d && user.role === "driver") {
        d = {
          id: `driver_${user.id}`,
          userId: user.id,
          name: user.name,
          status: "available",
          capacityKg: 100,
          location: { lat: p.lat, lng: p.lng },
          lastSeenAt: new Date().toISOString(),
          maintenanceStatus: "ok",
        };
        drivers.push(d);
      }
      if (!d) return ack?.({ error: "Driver identity required" });
      d.location = { lat: p.lat, lng: p.lng };
      d.lastSeenAt = new Date().toISOString();
      void persistDriver(d);
      void persistDriverLocation(d, {
        accuracy: typeof p.accuracy === "number" ? p.accuracy : undefined,
        source: p.source || "gps",
      });
      const update = {
        driverId: d.id,
        location: d.location,
        lastSeenAt: d.lastSeenAt,
      };
      io.to(`tenant:${user.organizationId}`).emit("driver:location", update);
      orders
        .filter((o) => o.assignedDriverId === d.id)
        .forEach((o) => {
          io.to(`track:${o.trackingCode}`).emit("driver:location", update);
          const transitions = geofenceTransitions(
            o,
            d.location,
            organizationSettings.geofenceRadiusMeters,
          );
          if (!transitions.length) return;
          const timestamp = new Date().toISOString();
          for (const transition of transitions) {
            o.events.push({
              id: crypto.randomUUID(),
              type: transition.type,
              message: transition.message,
              actorId: user.id,
              createdAt: timestamp,
            });
          }
          o.updatedAt = timestamp;
          void persistOrder(o);
          io.to(`tenant:${user.organizationId}`).emit("order:updated", o);
          io.to(`track:${o.trackingCode}`).emit("order:updated", o);
        });
      ack?.({ ok: true });
    });
  });
}
