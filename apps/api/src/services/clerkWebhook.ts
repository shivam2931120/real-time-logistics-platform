import { Webhook } from 'svix';
import { pool } from '../db/client.js';

const orgUuid='00000000-0000-0000-0000-000000000001';
export async function syncClerkWebhook(raw:Buffer, headers:Record<string,string|undefined>) {
  if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET) throw Object.assign(new Error('CLERK_WEBHOOK_SIGNING_SECRET is not configured'),{status:503});
  const payload=await new Webhook(process.env.CLERK_WEBHOOK_SIGNING_SECRET).verify(raw,{'svix-id':headers['svix-id']||'','svix-timestamp':headers['svix-timestamp']||'','svix-signature':headers['svix-signature']||''}) as unknown as {type:string;data:Record<string,unknown>};
  if (!pool) return {synced:false,mode:'memory'};
  if (payload.type==='user.deleted') { await pool.query(`DELETE FROM users WHERE clerk_user_id=$1`,[String(payload.data.id)]); return {synced:true,type:payload.type}; }
  if (!['user.created','user.updated'].includes(payload.type)) return {synced:true,type:payload.type};
  const data=payload.data; const primary=(data.email_addresses as Array<{email_address?:string}>|undefined)?.[0]?.email_address||''; const name=[data.first_name,data.last_name].filter(Boolean).join(' ')||primary.split('@')[0]||'RoutePulse user'; const metadata=(data.public_metadata||{}) as {role?:string}; const role=['admin','dispatcher','driver','customer'].includes(String(metadata.role))?String(metadata.role):'customer';
  await pool.query(`INSERT INTO users(id,organization_id,email,name,role,clerk_user_id) VALUES(gen_random_uuid(),$1,$2,$3,$4::user_role,$5) ON CONFLICT(clerk_user_id) DO UPDATE SET email=EXCLUDED.email,name=EXCLUDED.name,role=EXCLUDED.role`,[orgUuid,primary,name,role,String(data.id)]);
  return {synced:true,type:payload.type};
}
