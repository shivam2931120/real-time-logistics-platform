import "dotenv/config";
import { pool } from "./client.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

if (!pool)
  throw new Error("DATABASE_URL is required. Copy .env.example to .env first.");
const sql = await readFile(
  fileURLToPath(new URL("../../../../docs/schema.sql", import.meta.url)),
  "utf8",
);
const client = await pool.connect();
try {
  await client.query("CREATE EXTENSION IF NOT EXISTS citext");
  await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  // Apply the baseline on every run. The schema statements are idempotent, so
  // this also repairs a database that was only partially initialized.
  await client.query(sql);
  await client.query(
    `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS clerk_organization_id text`,
  );
  await client.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_user_id text`,
  );
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS users_clerk_user_id_idx ON users(clerk_user_id) WHERE clerk_user_id IS NOT NULL`,
  );
  const legacyDemoEmails = [
    "admin@routepulse.demo",
    "dispatch@routepulse.demo",
    "rohan@routepulse.demo",
    "meera@routepulse.demo",
    "customer@routepulse.demo",
  ];
  const cleanupMarker = await client.query(
    `SELECT 1 FROM schema_migrations WHERE version='004_remove_legacy_demo_state'`,
  );
  if (!cleanupMarker.rowCount) {
    await client.query("BEGIN");
    try {
      const demoUsers = await client.query<{ id: string }>(
        `SELECT id::text FROM users WHERE lower(email::text)=ANY($1::text[])`,
        [legacyDemoEmails],
      );
      const demoUserIds = demoUsers.rows.map((row) => row.id);
      const demoOrders = await client.query<{ id: string }>(
        `SELECT id::text FROM orders WHERE tracking_code LIKE 'RP-DEMO%'`,
      );
      const demoOrderIds = demoOrders.rows.map((row) => row.id);
      const demoTickets = await client.query<{ id: string }>(
        `SELECT id::text FROM support_tickets
         WHERE order_id=ANY($1::uuid[])
            OR created_by=ANY($2::uuid[])
            OR customer_id=ANY($2::uuid[])`,
        [demoOrderIds, demoUserIds],
      );
      const demoTicketIds = demoTickets.rows.map((row) => row.id);
      const demoDrivers = await client.query<{ id: string }>(
        `SELECT id::text FROM drivers WHERE user_id=ANY($1::uuid[])`,
        [demoUserIds],
      );
      const demoDriverIds = demoDrivers.rows.map((row) => row.id);

      const deleted = {
        supportMessages: 0,
        supportTickets: 0,
        notifications: 0,
        audits: 0,
        payments: 0,
        scans: 0,
        exceptions: 0,
        orders: 0,
        locations: 0,
        drivers: 0,
        users: 0,
      };
      if (demoTicketIds.length || demoUserIds.length) {
        deleted.supportMessages = (
          await client.query(
            `DELETE FROM support_messages WHERE sender_id=ANY($1::uuid[]) OR ticket_id=ANY($2::uuid[])`,
            [demoUserIds, demoTicketIds],
          )
        ).rowCount || 0;
        deleted.supportTickets = (
          await client.query(
            `DELETE FROM support_tickets WHERE id=ANY($1::uuid[])`,
            [demoTicketIds],
          )
        ).rowCount || 0;
      }
      deleted.notifications = (
        await client.query(
          `DELETE FROM notification_records WHERE user_id=ANY($1::uuid[]) OR order_id=ANY($2::uuid[])`,
          [demoUserIds, demoOrderIds],
        )
      ).rowCount || 0;
      deleted.audits = (
        await client.query(
          `DELETE FROM audit_events WHERE actor_id=ANY($1::uuid[]) OR resource_id=ANY($2::text[])`,
          [demoUserIds, demoOrderIds],
        )
      ).rowCount || 0;
      await client.query(
        `DELETE FROM order_events WHERE actor_id=ANY($1::uuid[]) OR order_id=ANY($2::uuid[])`,
        [demoUserIds, demoOrderIds],
      );
      deleted.payments = (
        await client.query(
          `DELETE FROM payments WHERE order_id=ANY($1::uuid[])`,
          [demoOrderIds],
        )
      ).rowCount || 0;
      await client.query(
        `DELETE FROM proof_of_delivery WHERE driver_id=ANY($1::uuid[]) OR order_id=ANY($2::uuid[])`,
        [demoDriverIds, demoOrderIds],
      );
      deleted.scans = (
        await client.query(
          `DELETE FROM parcel_scans WHERE order_id=ANY($1::uuid[]) OR scanned_by=ANY($2::uuid[])`,
          [demoOrderIds, demoUserIds],
        )
      ).rowCount || 0;
      deleted.exceptions = (
        await client.query(
          `DELETE FROM delivery_exceptions WHERE order_id=ANY($1::uuid[]) OR created_by=ANY($2::uuid[])`,
          [demoOrderIds, demoUserIds],
        )
      ).rowCount || 0;
      deleted.orders = (
        await client.query(
          `DELETE FROM orders WHERE id=ANY($1::uuid[])`,
          [demoOrderIds],
        )
      ).rowCount || 0;
      deleted.locations = (
        await client.query(
          `DELETE FROM driver_location_events WHERE driver_id=ANY($1::uuid[])`,
          [demoDriverIds],
        )
      ).rowCount || 0;
      deleted.drivers = (
        await client.query(
          `DELETE FROM drivers WHERE id=ANY($1::uuid[])`,
          [demoDriverIds],
        )
      ).rowCount || 0;
      deleted.users = (
        await client.query(
          `DELETE FROM users WHERE id=ANY($1::uuid[])`,
          [demoUserIds],
        )
      ).rowCount || 0;
      await client.query(
        `INSERT INTO schema_migrations(version) VALUES('004_remove_legacy_demo_state')`,
      );
      await client.query("COMMIT");
      console.info("RoutePulse legacy demo cleanup", deleted);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  await client.query(
    `INSERT INTO schema_migrations(version) VALUES('001_baseline'),('002_free_operations'),('003_self_service_reporting_support') ON CONFLICT DO NOTHING`,
  );
  console.info("RoutePulse database schema is current");
} finally {
  client.release();
  await pool.end();
}
