import { createHash } from "node:crypto";
import type {
  AuditRecord,
  DeliveryException,
  DeliveryProof,
  Driver,
  NotificationRecord,
  Order,
  OrderEvent,
  OrganizationSettings,
  Role,
  User,
  ParcelScan,
  SupportMessage,
  SupportTicket,
  CustomerAddressBookEntry,
  ServiceTerritory,
  OperatingCostRecord,
} from "@routepulse/shared";
import type { PoolClient } from "pg";
import { pool, dbEnabled } from "./client.js";
import {
  auditRecords,
  deliveryExceptions,
  drivers,
  notificationRecords,
  orders,
  saveOrganizationSettings,
  settingsForOrganization,
  parcelScans,
  supportMessages,
  supportTickets,
  customerAddressBook,
  serviceTerritories,
  operatingCosts,
  store,
  users,
} from "../domain/store.js";

export const demoOrganizationId = "org_demo";
export const demoOrganizationUuid = "00000000-0000-0000-0000-000000000001";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const asUuid = (value: string) => {
  if (uuidPattern.test(value)) return value.toLowerCase();
  const hex = createHash("md5").update(`routepulse:${value}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const organizationUuid = (value: string) =>
  value === demoOrganizationId ? demoOrganizationUuid : asUuid(value);
const organizationDomainId = (value: string) =>
  value === demoOrganizationUuid ? demoOrganizationId : value;
const paymentWebhookMemory = new Set<string>();
const localId = (value: string, candidates: Array<{ id: string }>) =>
  candidates.find((x) => asUuid(x.id) === value)?.id || value;
const iso = (value: Date | string) =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export async function initializePersistence() {
  if (!dbEnabled || !pool) return;
  const preserveShowcaseFixtures =
    process.env.AUTH_MODE === "clerk" && process.env.DEMO_AUTH_ENABLED === "true";
  const userRows = await pool.query(
    `SELECT id::text,organization_id::text,email,name,role FROM users`,
  );
  for (const row of userRows.rows) {
    const id = localId(row.id, users);
    const user: User = {
      id,
      organizationId: organizationDomainId(row.organization_id),
      email: row.email,
      name: row.name,
      role: row.role,
    };
    const index = users.findIndex((candidate) => candidate.id === id);
    if (index >= 0) users[index] = user;
    else users.push(user);
  }
  const driverRows = await pool.query(
    `SELECT id::text,organization_id::text,user_id::text,status,capacity_kg,current_lat,current_lng,last_seen_at,shift_start,shift_end,vehicle_plate,maintenance_due_at,maintenance_status FROM drivers`,
  );
  const orderRows = await pool.query(
    `SELECT id::text,organization_id::text,tracking_code,customer_name,customer_email,pickup,dropoff,package_weight_kg,priority,status,amount_minor,currency,payment_status,assigned_driver_id::text,delivery_window_start,delivery_notes,delivery_pin_hash,parcel_code,reschedule_count,cancelled_at,return_requested_at,return_reason,return_status,promised_at,delivered_at,created_at,updated_at FROM orders ORDER BY created_at DESC`,
  );
  const eventRows = await pool.query(
    `SELECT id::text,organization_id::text,order_id::text,type,message,actor_id::text,created_at FROM order_events ORDER BY created_at`,
  );
  const proofRows = await pool.query(
    `SELECT order_id::text,organization_id::text,driver_id::text,recipient_name,signature_data,photo_data,verification_method,proof_lat,proof_lng,created_at FROM proof_of_delivery`,
  );
  const exceptionRows = await pool.query(
    `SELECT id::text,organization_id::text,order_id::text,type,description,status,created_by::text,created_at,resolved_at,resolution FROM delivery_exceptions ORDER BY created_at DESC`,
  );
  const notificationRows = await pool.query(
    `SELECT id::text,organization_id::text,user_id::text,order_id::text,channel,title,message,status,read_at,created_at FROM notification_records ORDER BY created_at DESC LIMIT 500`,
  );
  const auditRows = await pool.query(
    `SELECT id::text,organization_id::text,actor_id::text,action,resource_type,resource_id,metadata,created_at FROM audit_events ORDER BY created_at DESC LIMIT 500`,
  );
  const settingsRow = await pool.query(
    `SELECT id::text,name,timezone,settings,clerk_organization_id FROM organizations`,
  );
  const scanRows = await pool.query(
    `SELECT id::text,organization_id::text,order_id::text,parcel_code,stage,scanned_by::text,scanned_at FROM parcel_scans ORDER BY scanned_at DESC`,
  );
  const ticketRows = await pool.query(
    `SELECT id::text,organization_id::text,order_id::text,customer_id::text,subject,category,priority,status,created_by::text,assigned_to::text,created_at,updated_at FROM support_tickets ORDER BY updated_at DESC`,
  );
  const messageRows = await pool.query(
    `SELECT id::text,organization_id::text,ticket_id::text,sender_id::text,sender_role,message,internal,created_at FROM support_messages ORDER BY created_at`,
  );
  const addressRows = await pool.query(
    `SELECT id::text,organization_id::text,user_id::text,label,address,delivery_notes,contact_name,created_at,updated_at FROM customer_addresses ORDER BY updated_at DESC`,
  );
  const territoryRows = await pool.query(
    `SELECT id::text,organization_id::text,name,polygon,active,created_at,updated_at FROM service_territories ORDER BY updated_at DESC`,
  );
  let operatingCostRows: {
    rows: Array<{
      id: string;
      organization_id: string;
      category: string;
      amount_minor: string | number;
      currency: string;
      incurred_at: string | Date;
      driver_id: string | null;
      route_run_id: string | null;
      note: string | null;
      source: string | null;
      created_at: string | Date;
    }>;
  } = { rows: [] };
  try {
    operatingCostRows = await pool.query(
      `SELECT id::text,organization_id::text,category,amount_minor,currency,incurred_at,driver_id::text,route_run_id::text,note,source,created_at FROM operating_cost_records ORDER BY incurred_at DESC LIMIT 5000`,
    );
  } catch {
    // The additive cost table may not exist until the next database migration;
    // keep the API bootable and let the write endpoint report the migration issue.
  }
  const loadedDrivers = driverRows.rows.map((row) => ({
      id: localId(row.id, drivers),
      userId: localId(row.user_id, users),
      name:
        users.find((u) => u.id === localId(row.user_id, users))?.name ||
        "Driver",
      status: row.status,
      capacityKg: Number(row.capacity_kg),
      location: { lat: Number(row.current_lat), lng: Number(row.current_lng) },
      lastSeenAt: iso(row.last_seen_at),
      shiftStart: row.shift_start || undefined,
      shiftEnd: row.shift_end || undefined,
      vehiclePlate: row.vehicle_plate || undefined,
      maintenanceDueAt: row.maintenance_due_at
        ? iso(row.maintenance_due_at)
        : undefined,
      maintenanceStatus: row.maintenance_status || "ok",
  })) as Driver[];
  const loadedAddresses = addressRows.rows.map((row) => ({
    id: localId(row.id, customerAddressBook),
    organizationId: organizationDomainId(row.organization_id),
    userId: localId(row.user_id, users),
    label: row.label,
    address: row.address,
    deliveryNotes: row.delivery_notes || undefined,
    contactName: row.contact_name || undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  })) as CustomerAddressBookEntry[];
  customerAddressBook.splice(0, customerAddressBook.length, ...loadedAddresses);
  const loadedTerritories = territoryRows.rows.map((row) => ({
    id: row.id,
    organizationId: organizationDomainId(row.organization_id),
    name: row.name,
    polygon: row.polygon,
    active: Boolean(row.active),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  })) as ServiceTerritory[];
  serviceTerritories.splice(0, serviceTerritories.length, ...loadedTerritories);
  operatingCosts.splice(
    0,
    operatingCosts.length,
    ...(operatingCostRows.rows.map((row) => ({
      id: row.id,
      organizationId: organizationDomainId(row.organization_id),
      category: row.category,
      amount: Number(row.amount_minor) / 100,
      currency: String(row.currency).trim(),
      incurredAt: iso(row.incurred_at),
      driverId: row.driver_id ? localId(row.driver_id, drivers) : undefined,
      routeRunId: row.route_run_id || undefined,
      note: row.note || undefined,
      source: row.source || "manual",
      createdAt: iso(row.created_at),
    })) as OperatingCostRecord[]),
  );
  if (!preserveShowcaseFixtures) drivers.splice(0, drivers.length, ...loadedDrivers);
  else {
    const loadedShowcaseDrivers = loadedDrivers.filter(
      (driver) => users.find((user) => user.id === driver.userId)?.organizationId === demoOrganizationId,
    );
    const loadedTenantDrivers = loadedDrivers.filter(
      (driver) => users.find((user) => user.id === driver.userId)?.organizationId !== demoOrganizationId,
    );
    const showcaseDrivers = loadedShowcaseDrivers.length
      ? loadedShowcaseDrivers
      : drivers.filter(
          (driver) => users.find((user) => user.id === driver.userId)?.organizationId === demoOrganizationId,
        );
    drivers.splice(0, drivers.length, ...showcaseDrivers, ...loadedTenantDrivers);
  }
  const loadedOrders = orderRows.rows.map((row) => {
    const proof = proofRows.rows.find((item) => item.order_id === row.id);
    const orderId = localId(row.id, orders);
    if (row.delivery_pin_hash)
      store.setDeliveryPinHash(orderId, row.delivery_pin_hash);
    return {
      id: orderId,
      organizationId: organizationDomainId(row.organization_id),
      trackingCode: row.tracking_code,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      pickup: row.pickup,
      dropoff: row.dropoff,
      packageWeightKg: Number(row.package_weight_kg),
      priority: row.priority,
      status: row.status,
      amount: Number(row.amount_minor) / 100,
      currency: row.currency.trim(),
      paymentStatus: row.payment_status,
      assignedDriverId: row.assigned_driver_id
        ? localId(row.assigned_driver_id, drivers)
        : undefined,
      deliveryWindowStart: row.delivery_window_start
        ? iso(row.delivery_window_start)
        : undefined,
      deliveryNotes: row.delivery_notes || undefined,
      parcelCode: row.parcel_code || undefined,
      rescheduleCount: Number(row.reschedule_count || 0),
      cancelledAt: row.cancelled_at ? iso(row.cancelled_at) : undefined,
      returnRequestedAt: row.return_requested_at ? iso(row.return_requested_at) : undefined,
      returnReason: row.return_reason || undefined,
      returnStatus: row.return_status || undefined,
      promisedAt: iso(row.promised_at),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      deliveredAt: row.delivered_at ? iso(row.delivered_at) : undefined,
      proof: proof
        ? {
            driverId: localId(proof.driver_id, drivers),
            recipientName: proof.recipient_name,
            signatureData: proof.signature_data,
            photoData: proof.photo_data || undefined,
            verificationMethod: proof.verification_method || undefined,
            location:
              proof.proof_lat === null || proof.proof_lng === null
                ? undefined
                : { lat: Number(proof.proof_lat), lng: Number(proof.proof_lng) },
            createdAt: iso(proof.created_at),
          }
        : undefined,
      events: eventRows.rows
        .filter((e) => e.order_id === row.id)
        .map((e) => ({
          id: localId(e.id, []),
          type: e.type,
          message: e.message,
          actorId: e.actor_id ? localId(e.actor_id, users) : undefined,
          createdAt: iso(e.created_at),
        })),
    } as Order;
  });
  if (!preserveShowcaseFixtures) orders.splice(0, orders.length, ...loadedOrders);
  else {
    const loadedShowcaseOrders = loadedOrders.filter(
      (order) => order.organizationId === demoOrganizationId,
    );
    const loadedTenantOrders = loadedOrders.filter(
      (order) => order.organizationId !== demoOrganizationId,
    );
    const showcaseOrders = loadedShowcaseOrders.length
      ? loadedShowcaseOrders
      : orders.filter((order) => order.organizationId === demoOrganizationId);
    orders.splice(0, orders.length, ...showcaseOrders, ...loadedTenantOrders);
  }
  deliveryExceptions.splice(
    0,
    deliveryExceptions.length,
    ...(exceptionRows.rows.map((row) => ({
      id: localId(row.id, []),
      organizationId: organizationDomainId(row.organization_id),
      orderId: localId(row.order_id, orders),
      type: row.type,
      description: row.description,
      status: row.status,
      createdBy: row.created_by ? localId(row.created_by, users) : "",
      createdAt: iso(row.created_at),
      resolvedAt: row.resolved_at ? iso(row.resolved_at) : undefined,
      resolution: row.resolution || undefined,
    })) as DeliveryException[]),
  );
  notificationRecords.splice(
    0,
    notificationRecords.length,
    ...(notificationRows.rows.map((row) => ({
      id: localId(row.id, []),
      organizationId: organizationDomainId(row.organization_id),
      userId: row.user_id ? localId(row.user_id, users) : undefined,
      orderId: row.order_id ? localId(row.order_id, orders) : undefined,
      channel: row.channel,
      title: row.title,
      message: row.message,
      status: row.status,
      readAt: row.read_at ? iso(row.read_at) : undefined,
      createdAt: iso(row.created_at),
    })) as NotificationRecord[]),
  );
  auditRecords.splice(
    0,
    auditRecords.length,
    ...(auditRows.rows.map((row) => ({
      id: localId(row.id, []),
      organizationId: organizationDomainId(row.organization_id),
      actorId: row.actor_id ? localId(row.actor_id, users) : undefined,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      metadata: row.metadata || {},
      createdAt: iso(row.created_at),
    })) as AuditRecord[]),
  );
  parcelScans.splice(
    0,
    parcelScans.length,
    ...(scanRows.rows.map((row) => ({
      id: localId(row.id, []),
      organizationId: organizationDomainId(row.organization_id),
      orderId: localId(row.order_id, orders),
      parcelCode: row.parcel_code,
      stage: row.stage,
      scannedBy: localId(row.scanned_by, users),
      scannedAt: iso(row.scanned_at),
    })) as ParcelScan[]),
  );
  supportTickets.splice(
    0,
    supportTickets.length,
    ...(ticketRows.rows.map((row) => {
      const latest = [...messageRows.rows]
        .reverse()
        .find((message) => message.ticket_id === row.id);
      return {
        id: localId(row.id, []),
        organizationId: organizationDomainId(row.organization_id),
        orderId: row.order_id ? localId(row.order_id, orders) : undefined,
        customerId: row.customer_id
          ? localId(row.customer_id, users)
          : undefined,
        subject: row.subject,
        category: row.category,
        priority: row.priority,
        status: row.status,
        createdBy: localId(row.created_by, users),
        assignedTo: row.assigned_to
          ? localId(row.assigned_to, users)
          : undefined,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        lastMessage: latest?.message,
      };
    }) as SupportTicket[]),
  );
  supportMessages.splice(
    0,
    supportMessages.length,
    ...(messageRows.rows.map((row) => ({
      id: localId(row.id, []),
      ticketId: localId(row.ticket_id, supportTickets),
      organizationId: organizationDomainId(row.organization_id),
      senderId: localId(row.sender_id, users),
      senderName: users.find(
        (user) => user.id === localId(row.sender_id, users),
      )?.name,
      senderRole: row.sender_role,
      message: row.message,
      internal: row.internal,
      createdAt: iso(row.created_at),
    })) as SupportMessage[]),
  );
  for (const row of settingsRow.rows) {
    const organizationId = organizationDomainId(row.id);
    const settings = settingsForOrganization(organizationId);
    Object.assign(settings, {
      organizationId,
      name: row.name,
      timezone: row.timezone,
      ...row.settings,
    });
    saveOrganizationSettings(settings);
  }
  console.info(
    `RoutePulse loaded ${orders.length} orders and ${drivers.length} drivers from PostgreSQL`,
  );
}

async function writeOrder(order: Order, db: Pick<PoolClient, "query">) {
  const orgId = organizationUuid(order.organizationId);
  await db.query(
    `INSERT INTO orders(id,organization_id,tracking_code,customer_name,customer_email,pickup,dropoff,package_weight_kg,priority,status,amount_minor,currency,payment_status,assigned_driver_id,delivery_window_start,delivery_notes,delivery_pin_hash,parcel_code,reschedule_count,cancelled_at,return_requested_at,return_reason,return_status,promised_at,delivered_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10::order_status,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27) ON CONFLICT(id) DO UPDATE SET customer_name=EXCLUDED.customer_name,customer_email=EXCLUDED.customer_email,pickup=EXCLUDED.pickup,dropoff=EXCLUDED.dropoff,package_weight_kg=EXCLUDED.package_weight_kg,priority=EXCLUDED.priority,status=EXCLUDED.status,amount_minor=EXCLUDED.amount_minor,currency=EXCLUDED.currency,payment_status=EXCLUDED.payment_status,assigned_driver_id=EXCLUDED.assigned_driver_id,delivery_window_start=EXCLUDED.delivery_window_start,delivery_notes=EXCLUDED.delivery_notes,delivery_pin_hash=COALESCE(EXCLUDED.delivery_pin_hash,orders.delivery_pin_hash),parcel_code=COALESCE(EXCLUDED.parcel_code,orders.parcel_code),reschedule_count=EXCLUDED.reschedule_count,cancelled_at=EXCLUDED.cancelled_at,return_requested_at=EXCLUDED.return_requested_at,return_reason=EXCLUDED.return_reason,return_status=EXCLUDED.return_status,promised_at=EXCLUDED.promised_at,delivered_at=EXCLUDED.delivered_at,updated_at=EXCLUDED.updated_at`,
    [
      asUuid(order.id),
      orgId,
      order.trackingCode,
      order.customerName,
      order.customerEmail,
      JSON.stringify(order.pickup),
      JSON.stringify(order.dropoff),
      order.packageWeightKg,
      order.priority,
      order.status,
      Math.round(order.amount * 100),
      order.currency,
      order.paymentStatus,
      order.assignedDriverId ? asUuid(order.assignedDriverId) : null,
      order.deliveryWindowStart || null,
      order.deliveryNotes || null,
      store.deliveryPinHash(order.id) || null,
      order.parcelCode || null,
      order.rescheduleCount || 0,
      order.cancelledAt || null,
      order.returnRequestedAt || null,
      order.returnReason || null,
      order.returnStatus || null,
      order.promisedAt,
      order.deliveredAt || null,
      order.createdAt,
      order.updatedAt,
    ],
  );
  for (const e of order.events)
    await db.query(
      `INSERT INTO order_events(id,organization_id,order_id,type,message,actor_id,created_at) VALUES($1,$2,$3,$4,$5,(SELECT id FROM users WHERE id=$6),$7) ON CONFLICT(id) DO NOTHING`,
      [
        asUuid(e.id),
        orgId,
        asUuid(order.id),
        e.type,
        e.message,
        e.actorId ? asUuid(e.actorId) : null,
        e.createdAt,
      ],
    );
}

async function writeDriver(driver: Driver, db: Pick<PoolClient, "query">) {
  const organizationId = organizationUuid(
    users.find((user) => user.id === driver.userId)?.organizationId ||
      demoOrganizationId,
  );
  await db.query(
    `INSERT INTO drivers(id,organization_id,user_id,status,capacity_kg,current_lat,current_lng,last_seen_at,shift_start,shift_end,vehicle_plate,maintenance_due_at,maintenance_status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,current_lat=EXCLUDED.current_lat,current_lng=EXCLUDED.current_lng,last_seen_at=EXCLUDED.last_seen_at,shift_start=EXCLUDED.shift_start,shift_end=EXCLUDED.shift_end,vehicle_plate=EXCLUDED.vehicle_plate,maintenance_due_at=EXCLUDED.maintenance_due_at,maintenance_status=EXCLUDED.maintenance_status`,
    [
      asUuid(driver.id),
      organizationId,
      asUuid(driver.userId),
      driver.status,
      driver.capacityKg,
      driver.location.lat,
      driver.location.lng,
      driver.lastSeenAt,
      driver.shiftStart || null,
      driver.shiftEnd || null,
      driver.vehiclePlate || null,
      driver.maintenanceDueAt || null,
      driver.maintenanceStatus || "ok",
    ],
  );
}

export async function persistOrder(order: Order) {
  if (!dbEnabled || !pool) return;
  await writeOrder(order, pool);
}
export async function persistDriver(driver: Driver) {
  if (!dbEnabled || !pool || driver.userId.startsWith("demo_")) return;
  await writeDriver(driver, pool);
}
export async function persistDriverLocation(
  driver: Driver,
  reading: { lat?: number; lng?: number; accuracy?: number; source?: string; recordedAt?: string } = {},
) {
  if (!dbEnabled || !pool || driver.userId.startsWith("demo_")) return;
  await pool.query(
    `INSERT INTO driver_location_events(id,organization_id,driver_id,latitude,longitude,accuracy_meters,source,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      crypto.randomUUID(),
      organizationUuid(
        users.find((user) => user.id === driver.userId)?.organizationId ||
          demoOrganizationId,
      ),
      asUuid(driver.id),
      reading.lat ?? driver.location.lat,
      reading.lng ?? driver.location.lng,
      reading.accuracy ?? null,
      reading.source || "gps",
      reading.recordedAt || driver.lastSeenAt,
    ],
  );
}
export async function persistDriverAndLocation(
  driver: Driver,
  reading: { lat?: number; lng?: number; accuracy?: number; source?: string; recordedAt?: string } = {},
) {
  if (!dbEnabled || !pool || driver.userId.startsWith("demo_")) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await writeDriver(driver, client);
    await client.query(
      `INSERT INTO driver_location_events(id,organization_id,driver_id,latitude,longitude,accuracy_meters,source,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        crypto.randomUUID(),
        organizationUuid(
          users.find((user) => user.id === driver.userId)?.organizationId ||
            demoOrganizationId,
        ),
        asUuid(driver.id),
          reading.lat ?? driver.location.lat,
          reading.lng ?? driver.location.lng,
        reading.accuracy ?? null,
        reading.source || "gps",
        reading.recordedAt || driver.lastSeenAt,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function listDriverLocations(
  driverId: string,
  organizationId: string,
  limit = 100,
) {
  if (!dbEnabled || !pool) return [];
  const result = await pool.query(
    `SELECT latitude,longitude,accuracy_meters,source,recorded_at FROM driver_location_events WHERE organization_id=$1 AND driver_id=$2 ORDER BY recorded_at DESC LIMIT $3`,
    [organizationUuid(organizationId), asUuid(driverId), Math.min(Math.max(limit, 1), 500)],
  );
  return result.rows.map((row) => ({
    lat: Number(row.latitude),
    lng: Number(row.longitude),
    accuracy: row.accuracy_meters === null ? undefined : Number(row.accuracy_meters),
    source: row.source,
    recordedAt: iso(row.recorded_at),
  }));
}
export type PaymentRecordInput = {
  organizationId?: string;
  orderId: string;
  provider: string;
  providerRef: string;
  amountMinor: number;
  currency: string;
  status: string;
};
async function writePaymentRecord(input: PaymentRecordInput, db: Pick<PoolClient, "query">) {
  await db.query(
    `INSERT INTO payments(id,organization_id,order_id,provider,provider_ref,amount_minor,currency,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(provider,provider_ref) DO UPDATE SET status=EXCLUDED.status,amount_minor=EXCLUDED.amount_minor,currency=EXCLUDED.currency`,
    [
      crypto.randomUUID(),
      organizationUuid(input.organizationId || demoOrganizationId),
      asUuid(input.orderId),
      input.provider,
      input.providerRef,
      input.amountMinor,
      input.currency,
      input.status,
    ],
  );
}
export async function persistPaymentRecord(input: PaymentRecordInput) {
  if (!dbEnabled || !pool) return;
  await writePaymentRecord(input, pool);
}
export async function persistPaymentAndOrder(
  order: Order,
  input: PaymentRecordInput,
) {
  if (!dbEnabled || !pool) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await writeOrder(order, client);
    await writePaymentRecord(input, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function paymentOrderId(provider: string, providerRef: string) {
  if (!dbEnabled || !pool) return undefined;
  const result = await pool.query<{ order_id: string }>(
    `SELECT order_id::text FROM payments WHERE provider=$1 AND provider_ref=$2 ORDER BY created_at DESC LIMIT 1`,
    [provider, providerRef],
  );
  return result.rows[0]?.order_id;
}
export async function recordPaymentWebhook(input: {
  eventKey: string;
  eventName: string;
  payload: unknown;
}) {
  if (!dbEnabled || !pool) {
    if (paymentWebhookMemory.has(input.eventKey)) return false;
    paymentWebhookMemory.add(input.eventKey);
    return true;
  }
  const result = await pool.query(
    `INSERT INTO payment_webhook_events(id,provider,event_key,event_name,payload) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(event_key) DO NOTHING`,
    [
      crypto.randomUUID(),
      "razorpay",
      input.eventKey,
      input.eventName,
      JSON.stringify(input.payload),
    ],
  );
  return result.rowCount === 1;
}
export async function persistException(item: DeliveryException) {
  if (!dbEnabled || !pool) return;
  await pool.query(
    `INSERT INTO delivery_exceptions(id,organization_id,order_id,type,description,status,created_by,created_at,resolved_at,resolution) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,resolved_at=EXCLUDED.resolved_at,resolution=EXCLUDED.resolution`,
    [
      asUuid(item.id),
      organizationUuid(item.organizationId),
      asUuid(item.orderId),
      item.type,
      item.description,
      item.status,
      item.createdBy ? asUuid(item.createdBy) : null,
      item.createdAt,
      item.resolvedAt || null,
      item.resolution || null,
    ],
  );
}
export async function persistExceptionAndOrder(
  item: DeliveryException,
  order: Order,
) {
  if (!dbEnabled || !pool) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO delivery_exceptions(id,organization_id,order_id,type,description,status,created_by,created_at,resolved_at,resolution) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,resolved_at=EXCLUDED.resolved_at,resolution=EXCLUDED.resolution`,
      [
        asUuid(item.id),
        organizationUuid(item.organizationId),
        asUuid(item.orderId),
        item.type,
        item.description,
        item.status,
        item.createdBy ? asUuid(item.createdBy) : null,
        item.createdAt,
        item.resolvedAt || null,
        item.resolution || null,
      ],
    );
    await writeOrder(order, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function persistNotification(item: NotificationRecord) {
  if (!dbEnabled || !pool) return;
  await pool.query(
    `INSERT INTO notification_records(id,organization_id,user_id,order_id,channel,title,message,status,read_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,read_at=EXCLUDED.read_at`,
    [
      asUuid(item.id),
      organizationUuid(item.organizationId),
      item.userId ? asUuid(item.userId) : null,
      item.orderId ? asUuid(item.orderId) : null,
      item.channel,
      item.title,
      item.message,
      item.status,
      item.readAt || null,
      item.createdAt,
    ],
  );
}
export async function persistAudit(item: AuditRecord) {
  if (!dbEnabled || !pool) return;
  await pool.query(
    `INSERT INTO audit_events(id,organization_id,actor_id,action,resource_type,resource_id,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT(id) DO NOTHING`,
    [
      asUuid(item.id),
      organizationUuid(item.organizationId),
      item.actorId ? asUuid(item.actorId) : null,
      item.action,
      item.resourceType,
      item.resourceId,
      JSON.stringify(item.metadata),
      item.createdAt,
    ],
  );
}
export async function persistProof(order: Order, proof: DeliveryProof) {
  if (!dbEnabled || !pool) return;
  await pool.query(
    `INSERT INTO proof_of_delivery(order_id,organization_id,driver_id,recipient_name,signature_data,photo_data,verification_method,proof_lat,proof_lng,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(order_id) DO UPDATE SET recipient_name=EXCLUDED.recipient_name,signature_data=EXCLUDED.signature_data,photo_data=EXCLUDED.photo_data,verification_method=EXCLUDED.verification_method,proof_lat=EXCLUDED.proof_lat,proof_lng=EXCLUDED.proof_lng,created_at=EXCLUDED.created_at`,
    [
      asUuid(order.id),
      organizationUuid(order.organizationId),
      asUuid(proof.driverId),
      proof.recipientName,
      proof.signatureData,
      proof.photoData || null,
      proof.verificationMethod || "pin",
      proof.location?.lat ?? null,
      proof.location?.lng ?? null,
      proof.createdAt,
    ],
  );
}
export async function persistProofAndDelivery(
  order: Order,
  driver: Driver,
  proof: DeliveryProof,
) {
  if (!dbEnabled || !pool) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await writeOrder(order, client);
    await writeDriver(driver, client);
    await client.query(
      `INSERT INTO proof_of_delivery(order_id,organization_id,driver_id,recipient_name,signature_data,photo_data,verification_method,proof_lat,proof_lng,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(order_id) DO UPDATE SET recipient_name=EXCLUDED.recipient_name,signature_data=EXCLUDED.signature_data,photo_data=EXCLUDED.photo_data,verification_method=EXCLUDED.verification_method,proof_lat=EXCLUDED.proof_lat,proof_lng=EXCLUDED.proof_lng,created_at=EXCLUDED.created_at`,
      [
        asUuid(order.id),
        organizationUuid(order.organizationId),
        asUuid(proof.driverId),
        proof.recipientName,
        proof.signatureData,
        proof.photoData || null,
        proof.verificationMethod || "pin",
        proof.location?.lat ?? null,
        proof.location?.lng ?? null,
        proof.createdAt,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function persistSettings(settings: OrganizationSettings) {
  if (!dbEnabled || !pool) return;
  await pool.query(
    `UPDATE organizations SET name=$1,timezone=$2,settings=$3::jsonb WHERE id=$4`,
    [
      settings.name,
      settings.timezone,
      JSON.stringify({
        geofenceRadiusMeters: settings.geofenceRadiusMeters,
        averageSpeedKph: settings.averageSpeedKph,
        notificationsEnabled: settings.notificationsEnabled,
        costPerKm: settings.costPerKm,
        costPerStop: settings.costPerStop,
      }),
      organizationUuid(settings.organizationId),
    ],
  );
}
export async function persistOperatingCost(record: OperatingCostRecord) {
  if (!dbEnabled || !pool) return;
  await pool.query(
    `INSERT INTO operating_cost_records(id,organization_id,category,amount_minor,currency,incurred_at,driver_id,route_run_id,note,source,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT(id) DO UPDATE SET category=EXCLUDED.category,amount_minor=EXCLUDED.amount_minor,currency=EXCLUDED.currency,incurred_at=EXCLUDED.incurred_at,driver_id=EXCLUDED.driver_id,route_run_id=EXCLUDED.route_run_id,note=EXCLUDED.note,source=EXCLUDED.source`,
    [
      asUuid(record.id),
      organizationUuid(record.organizationId),
      record.category,
      Math.round(record.amount * 100),
      record.currency,
      record.incurredAt,
      record.driverId ? asUuid(record.driverId) : null,
      record.routeRunId ? asUuid(record.routeRunId) : null,
      record.note || null,
      record.source,
      record.createdAt,
    ],
  );
}
export async function persistUserRole(userId: string, role: Role) {
  if (!dbEnabled || !pool) return;
  await pool.query(`UPDATE users SET role=$1::user_role WHERE id=$2`, [
    role,
    asUuid(userId),
  ]);
}
export async function persistParcelScan(scan: ParcelScan) {
  if (!dbEnabled || !pool) return;
  await pool.query(
    `INSERT INTO parcel_scans(id,organization_id,order_id,parcel_code,stage,scanned_by,scanned_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(order_id,stage) DO NOTHING`,
    [
      asUuid(scan.id),
      organizationUuid(scan.organizationId),
      asUuid(scan.orderId),
      scan.parcelCode,
      scan.stage,
      asUuid(scan.scannedBy),
      scan.scannedAt,
    ],
  );
}
export async function persistParcelScanAndOrder(
  scan: ParcelScan,
  order: Order,
) {
  if (!dbEnabled || !pool) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO parcel_scans(id,organization_id,order_id,parcel_code,stage,scanned_by,scanned_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(order_id,stage) DO NOTHING`,
      [
        asUuid(scan.id),
        organizationUuid(scan.organizationId),
        asUuid(scan.orderId),
        scan.parcelCode,
        scan.stage,
        asUuid(scan.scannedBy),
        scan.scannedAt,
      ],
    );
    await writeOrder(order, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function persistSupportTicket(ticket: SupportTicket) {
  if (!dbEnabled || !pool) return;
  await pool.query(
    `INSERT INTO support_tickets(id,organization_id,order_id,customer_id,subject,category,priority,status,created_by,assigned_to,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(id) DO UPDATE SET subject=EXCLUDED.subject,priority=EXCLUDED.priority,status=EXCLUDED.status,assigned_to=EXCLUDED.assigned_to,updated_at=EXCLUDED.updated_at`,
    [
      asUuid(ticket.id),
      organizationUuid(ticket.organizationId),
      ticket.orderId ? asUuid(ticket.orderId) : null,
      ticket.customerId ? asUuid(ticket.customerId) : null,
      ticket.subject,
      ticket.category,
      ticket.priority,
      ticket.status,
      asUuid(ticket.createdBy),
      ticket.assignedTo ? asUuid(ticket.assignedTo) : null,
      ticket.createdAt,
      ticket.updatedAt,
    ],
  );
}
export async function persistSupportMessage(message: SupportMessage) {
  if (!dbEnabled || !pool) return;
  await pool.query(
    `INSERT INTO support_messages(id,organization_id,ticket_id,sender_id,sender_role,message,internal,created_at) VALUES($1,$2,$3,$4,$5::user_role,$6,$7,$8) ON CONFLICT(id) DO NOTHING`,
    [
      asUuid(message.id),
      organizationUuid(message.organizationId),
      asUuid(message.ticketId),
      asUuid(message.senderId),
      message.senderRole,
      message.message,
      message.internal,
      message.createdAt,
    ],
  );
}
export async function persistSupportTicketWithMessage(
  ticket: SupportTicket,
  message: SupportMessage,
) {
  if (!dbEnabled || !pool) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO support_tickets(id,organization_id,order_id,customer_id,subject,category,priority,status,created_by,assigned_to,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(id) DO UPDATE SET subject=EXCLUDED.subject,priority=EXCLUDED.priority,status=EXCLUDED.status,assigned_to=EXCLUDED.assigned_to,updated_at=EXCLUDED.updated_at`,
      [
        asUuid(ticket.id),
        organizationUuid(ticket.organizationId),
        ticket.orderId ? asUuid(ticket.orderId) : null,
        ticket.customerId ? asUuid(ticket.customerId) : null,
        ticket.subject,
        ticket.category,
        ticket.priority,
        ticket.status,
        asUuid(ticket.createdBy),
        ticket.assignedTo ? asUuid(ticket.assignedTo) : null,
        ticket.createdAt,
        ticket.updatedAt,
      ],
    );
    await client.query(
      `INSERT INTO support_messages(id,organization_id,ticket_id,sender_id,sender_role,message,internal,created_at) VALUES($1,$2,$3,$4,$5::user_role,$6,$7,$8) ON CONFLICT(id) DO NOTHING`,
      [
        asUuid(message.id),
        organizationUuid(message.organizationId),
        asUuid(message.ticketId),
        asUuid(message.senderId),
        message.senderRole,
        message.message,
        message.internal,
        message.createdAt,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function persistOrderAndDriver(order: Order, driver: Driver) {
  if (!dbEnabled || !pool) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await writeOrder(order, client);
    await writeDriver(driver, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function persistCustomerAddress(entry: CustomerAddressBookEntry) {
  if (!dbEnabled || !pool) return;
  await pool.query(
    `INSERT INTO customer_addresses(id,organization_id,user_id,label,address,delivery_notes,contact_name,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
     ON CONFLICT(id) DO UPDATE SET label=EXCLUDED.label,address=EXCLUDED.address,delivery_notes=EXCLUDED.delivery_notes,contact_name=EXCLUDED.contact_name,updated_at=EXCLUDED.updated_at`,
    [
      asUuid(entry.id),
      organizationUuid(entry.organizationId),
      asUuid(entry.userId),
      entry.label,
      JSON.stringify(entry.address),
      entry.deliveryNotes || null,
      entry.contactName || null,
      entry.createdAt,
      entry.updatedAt,
    ],
  );
}
export async function deleteCustomerAddress(id: string, organizationId: string, userId: string) {
  if (!dbEnabled || !pool) return;
  await pool.query(
    `DELETE FROM customer_addresses WHERE id=$1 AND organization_id=$2 AND user_id=$3`,
    [asUuid(id), organizationUuid(organizationId), asUuid(userId)],
  );
}
export async function persistServiceTerritory(territory: ServiceTerritory) {
  if (!dbEnabled || !pool) return;
  await pool.query(
    `INSERT INTO service_territories(id,organization_id,name,polygon,active,created_at,updated_at)
     VALUES($1,$2,$3,$4::jsonb,$5,$6,$7)
     ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,polygon=EXCLUDED.polygon,active=EXCLUDED.active,updated_at=EXCLUDED.updated_at`,
    [
      asUuid(territory.id),
      organizationUuid(territory.organizationId),
      territory.name,
      JSON.stringify(territory.polygon),
      territory.active,
      territory.createdAt,
      territory.updatedAt,
    ],
  );
}
export async function deleteServiceTerritory(id: string, organizationId: string) {
  if (!dbEnabled || !pool) return;
  await pool.query(
    `DELETE FROM service_territories WHERE id=$1 AND organization_id=$2`,
    [asUuid(id), organizationUuid(organizationId)],
  );
}
export function persistenceMode() {
  return dbEnabled ? "postgresql" : "memory-demo";
}
