import { createHash } from 'node:crypto';
import type { Driver, Order, OrderEvent, User } from '@routepulse/shared';
import type { PoolClient } from 'pg';
import { pool, dbEnabled } from './client.js';
import { drivers, orders, users } from '../domain/store.js';

export const demoOrganizationId = 'org_demo';
export const demoOrganizationUuid = '00000000-0000-0000-0000-000000000001';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const asUuid = (value: string) => {
  if (uuidPattern.test(value)) return value.toLowerCase();
  const hex = createHash('md5').update(`routepulse:${value}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};
const organizationUuid = (value: string) => value === demoOrganizationId ? demoOrganizationUuid : asUuid(value);
const organizationDomainId = (value: string) => value === demoOrganizationUuid ? demoOrganizationId : value;
const localId = (value: string, candidates: Array<{ id: string }>) => candidates.find(x => asUuid(x.id) === value)?.id || value;
const iso = (value: Date | string) => value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export async function initializePersistence() {
  if (!dbEnabled || !pool) return;
  const driverRows = await pool.query(`SELECT id::text,user_id::text,status,capacity_kg,current_lat,current_lng,last_seen_at FROM drivers WHERE organization_id=$1`, [demoOrganizationUuid]);
  const orderRows = await pool.query(`SELECT id::text,organization_id::text,tracking_code,customer_name,customer_email,pickup,dropoff,package_weight_kg,priority,status,amount_minor,currency,payment_status,assigned_driver_id::text,promised_at,delivered_at,created_at,updated_at FROM orders WHERE organization_id=$1 ORDER BY created_at DESC`, [demoOrganizationUuid]);
  const eventRows = await pool.query(`SELECT id::text,order_id::text,type,message,actor_id::text,created_at FROM order_events WHERE organization_id=$1 ORDER BY created_at`, [demoOrganizationUuid]);
  drivers.splice(0, drivers.length, ...driverRows.rows.map(row => ({ id: localId(row.id, drivers), userId: localId(row.user_id, users), name: users.find(u => u.id === localId(row.user_id, users))?.name || 'Driver', status: row.status, capacityKg: Number(row.capacity_kg), location: { lat: Number(row.current_lat), lng: Number(row.current_lng) }, lastSeenAt: iso(row.last_seen_at) })) as Driver[]);
  orders.splice(0, orders.length, ...orderRows.rows.map(row => ({ id: localId(row.id, orders), organizationId: organizationDomainId(row.organization_id), trackingCode: row.tracking_code, customerName: row.customer_name, customerEmail: row.customer_email, pickup: row.pickup, dropoff: row.dropoff, packageWeightKg: Number(row.package_weight_kg), priority: row.priority, status: row.status, amount: Number(row.amount_minor) / 100, currency: row.currency.trim(), paymentStatus: row.payment_status, assignedDriverId: row.assigned_driver_id ? localId(row.assigned_driver_id, drivers) : undefined, promisedAt: iso(row.promised_at), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), deliveredAt: row.delivered_at ? iso(row.delivered_at) : undefined, events: eventRows.rows.filter(e => e.order_id === row.id).map(e => ({ id: localId(e.id, []), type: e.type, message: e.message, actorId: e.actor_id ? localId(e.actor_id, users) : undefined, createdAt: iso(e.created_at) })) })) as Order[]);
  console.info(`RoutePulse loaded ${orders.length} orders and ${drivers.length} drivers from PostgreSQL`);
}

async function writeOrder(order: Order, db: Pick<PoolClient, 'query'>) {
  const orgId = organizationUuid(order.organizationId);
  await db.query(`INSERT INTO orders(id,organization_id,tracking_code,customer_name,customer_email,pickup,dropoff,package_weight_kg,priority,status,amount_minor,currency,payment_status,assigned_driver_id,promised_at,delivered_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10::order_status,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT(id) DO UPDATE SET customer_name=EXCLUDED.customer_name,customer_email=EXCLUDED.customer_email,pickup=EXCLUDED.pickup,dropoff=EXCLUDED.dropoff,package_weight_kg=EXCLUDED.package_weight_kg,priority=EXCLUDED.priority,status=EXCLUDED.status,amount_minor=EXCLUDED.amount_minor,currency=EXCLUDED.currency,payment_status=EXCLUDED.payment_status,assigned_driver_id=EXCLUDED.assigned_driver_id,promised_at=EXCLUDED.promised_at,delivered_at=EXCLUDED.delivered_at,updated_at=EXCLUDED.updated_at`, [asUuid(order.id), orgId, order.trackingCode, order.customerName, order.customerEmail, JSON.stringify(order.pickup), JSON.stringify(order.dropoff), order.packageWeightKg, order.priority, order.status, Math.round(order.amount * 100), order.currency, order.paymentStatus, order.assignedDriverId ? asUuid(order.assignedDriverId) : null, order.promisedAt, order.deliveredAt || null, order.createdAt, order.updatedAt]);
  for (const e of order.events) await db.query(`INSERT INTO order_events(id,organization_id,order_id,type,message,actor_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING`, [asUuid(e.id), orgId, asUuid(order.id), e.type, e.message, e.actorId ? asUuid(e.actorId) : null, e.createdAt]);
}

async function writeDriver(driver: Driver, db: Pick<PoolClient, 'query'>) {
  await db.query(`UPDATE drivers SET status=$1,current_lat=$2,current_lng=$3,last_seen_at=$4 WHERE id=$5`, [driver.status, driver.location.lat, driver.location.lng, driver.lastSeenAt, asUuid(driver.id)]);
}

export async function persistOrder(order: Order) {
  if (!dbEnabled || !pool) return;
  await writeOrder(order, pool);
}
export async function persistDriver(driver: Driver) { if (!dbEnabled || !pool) return; await writeDriver(driver, pool); }
export async function persistOrderAndDriver(order: Order, driver: Driver) {
  if (!dbEnabled || !pool) return;
  const client = await pool.connect();
  try { await client.query('BEGIN'); await writeOrder(order, client); await writeDriver(driver, client); await client.query('COMMIT'); }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export function persistenceMode() { return dbEnabled ? 'postgresql' : 'memory-demo'; }
