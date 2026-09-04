import 'dotenv/config';
import { pool } from './client.js';
import { users, drivers, orders } from '../domain/store.js';
import { createHash } from 'node:crypto';

const asUuid = (value: string) => { const hex = createHash('md5').update(`routepulse:${value}`).digest('hex'); return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-${hex.slice(16,20)}-${hex.slice(20)}`; };

if (!pool) throw new Error('DATABASE_URL is required.');
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(`INSERT INTO organizations(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING`, ['00000000-0000-0000-0000-000000000001','RoutePulse Demo']);
  for (const user of users) await client.query(`INSERT INTO users(id,organization_id,email,name,role) VALUES($1,$2,$3,$4,$5::user_role) ON CONFLICT DO NOTHING`, [asUuid(user.id), '00000000-0000-0000-0000-000000000001', user.email, user.name, user.role]);
  for (const driver of drivers) await client.query(`INSERT INTO drivers(id,organization_id,user_id,status,capacity_kg,current_lat,current_lng,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`, [asUuid(driver.id), '00000000-0000-0000-0000-000000000001', asUuid(driver.userId), driver.status, driver.capacityKg, driver.location.lat, driver.location.lng, driver.lastSeenAt]);
  for (const order of orders) { await client.query(`INSERT INTO orders(id,organization_id,tracking_code,customer_name,customer_email,pickup,dropoff,package_weight_kg,priority,status,amount_minor,currency,payment_status,assigned_driver_id,promised_at,delivered_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10::order_status,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT DO NOTHING`, [asUuid(order.id),'00000000-0000-0000-0000-000000000001',order.trackingCode,order.customerName,order.customerEmail,JSON.stringify(order.pickup),JSON.stringify(order.dropoff),order.packageWeightKg,order.priority,order.status,Math.round(order.amount*100),order.currency,order.paymentStatus,order.assignedDriverId?asUuid(order.assignedDriverId):null,order.promisedAt,order.deliveredAt||null,order.createdAt,order.updatedAt]); for (const e of order.events) await client.query(`INSERT INTO order_events(id,organization_id,order_id,type,message,actor_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,[asUuid(e.id),'00000000-0000-0000-0000-000000000001',asUuid(order.id),e.type,e.message,e.actorId?asUuid(e.actorId):null,e.createdAt]); }
  await client.query(`UPDATE orders SET customer_name=$1,customer_email=$2 WHERE id=$3 AND customer_email='vikram@example.com'`, ['Kabir Customer','customer@routepulse.demo',asUuid('ord_1002')]);
  await client.query('COMMIT'); console.info('RoutePulse demo data seeded');
} catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); await pool.end(); }
