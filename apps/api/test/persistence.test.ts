import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Order } from "@routepulse/shared";
import { pool } from "../src/db/client.js";
import {
  asUuid,
  initializePersistence,
  persistOrder,
} from "../src/db/persistence.js";
import { orders } from "../src/domain/store.js";

const runDatabaseTests = process.env.RUN_DB_TESTS === "1" && Boolean(pool);
const testOrderId = randomUUID();

describe.runIf(runDatabaseTests)("PostgreSQL persistence", () => {
  afterAll(async () => {
    if (!pool) return;
    await pool.query("DELETE FROM orders WHERE id=$1", [asUuid(testOrderId)]);
    await pool.end();
  });

  it("keeps tenant and entity IDs stable across a database reload", async () => {
    const createdAt = new Date().toISOString();
    const order: Order = {
      id: testOrderId,
      organizationId: "org_demo",
      trackingCode: `RP-T${testOrderId.slice(0, 6).toUpperCase()}`,
      customerName: "Persistence Test",
      customerEmail: "persistence@example.com",
      pickup: { label: "Persistence Origin", lat: 12.97, lng: 77.59 },
      dropoff: { label: "Persistence Destination", lat: 12.95, lng: 77.61 },
      packageWeightKg: 1,
      priority: "standard",
      status: "pending",
      amount: 100,
      currency: "INR",
      paymentStatus: "unpaid",
      promisedAt: new Date(Date.now() + 3_600_000).toISOString(),
      createdAt,
      updatedAt: createdAt,
      events: [
        {
          id: randomUUID(),
          type: "created",
          message: "Persistence test created",
          actorId: "u_dispatch",
          createdAt,
        },
      ],
    };

    await persistOrder(order);
    orders.splice(0, orders.length);
    await initializePersistence();
    const reloaded = orders.find((candidate) => candidate.id === testOrderId);
    expect(reloaded).toMatchObject({
      id: testOrderId,
      organizationId: "org_demo",
      trackingCode: order.trackingCode,
    });
    expect(reloaded?.events).toHaveLength(1);
  }, 20_000);
});
