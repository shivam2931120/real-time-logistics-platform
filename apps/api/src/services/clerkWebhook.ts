import { Webhook } from 'svix';
import { pool } from '../db/client.js';
import { upsertClerkUser } from './clerkUserSync.js';

export async function syncClerkWebhook(raw:Buffer, headers:Record<string,string|undefined>) {
  if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET) throw Object.assign(new Error('CLERK_WEBHOOK_SIGNING_SECRET is not configured'),{status:503});
  const payload=await new Webhook(process.env.CLERK_WEBHOOK_SIGNING_SECRET).verify(raw,{'svix-id':headers['svix-id']||'','svix-timestamp':headers['svix-timestamp']||'','svix-signature':headers['svix-signature']||''}) as unknown as {type:string;data:Record<string,unknown>};
  if (!pool) return {synced:false,mode:'memory'};
  if (payload.type==='user.deleted') { await pool.query(`UPDATE users SET clerk_user_id=NULL WHERE clerk_user_id=$1`,[String(payload.data.id)]);return {synced:true,type:payload.type}; }
  if (!['user.created','user.updated'].includes(payload.type)) return {synced:true,type:payload.type};
  const data=payload.data; const primary=(data.email_addresses as Array<{id?:string;email_address?:string}>|undefined)?.find(item=>item.id===data.primary_email_address_id)?.email_address||(data.email_addresses as Array<{email_address?:string}>|undefined)?.[0]?.email_address||''; const name=[data.first_name,data.last_name].filter(Boolean).join(' ')||primary.split('@')[0]||'RoutePulse user'; const metadata=(data.public_metadata||{}) as {role?:string};
  await upsertClerkUser({clerkUserId:String(data.id),email:primary,name,role:metadata.role});
  return {synced:true,type:payload.type};
}
