import { Webhook } from 'svix';
import { pool } from '../db/client.js';
import type { Role, User } from '@routepulse/shared';
import { users } from '../domain/store.js';
import { asUuid, demoOrganizationId, demoOrganizationUuid } from '../db/persistence.js';

const roles: Role[]=['admin','dispatcher','driver','customer'];
const syncMemoryUser=(user:User)=>{const index=users.findIndex(candidate=>candidate.id===user.id);if(index>=0)users[index]=user;else users.push(user)};
export async function syncClerkWebhook(raw:Buffer, headers:Record<string,string|undefined>) {
  if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET) throw Object.assign(new Error('CLERK_WEBHOOK_SIGNING_SECRET is not configured'),{status:503});
  const payload=await new Webhook(process.env.CLERK_WEBHOOK_SIGNING_SECRET).verify(raw,{'svix-id':headers['svix-id']||'','svix-timestamp':headers['svix-timestamp']||'','svix-signature':headers['svix-signature']||''}) as unknown as {type:string;data:Record<string,unknown>};
  if (!pool) return {synced:false,mode:'memory'};
  if (payload.type==='user.deleted') { await pool.query(`UPDATE users SET clerk_user_id=NULL WHERE clerk_user_id=$1`,[String(payload.data.id)]);return {synced:true,type:payload.type}; }
  if (!['user.created','user.updated'].includes(payload.type)) return {synced:true,type:payload.type};
  const data=payload.data; const primary=(data.email_addresses as Array<{id?:string;email_address?:string}>|undefined)?.find(item=>item.id===data.primary_email_address_id)?.email_address||(data.email_addresses as Array<{email_address?:string}>|undefined)?.[0]?.email_address||''; const name=[data.first_name,data.last_name].filter(Boolean).join(' ')||primary.split('@')[0]||'RoutePulse user'; const metadata=(data.public_metadata||{}) as {role?:string}; const role=roles.includes(String(metadata.role) as Role)?String(metadata.role) as Role:'customer';const clerkUserId=String(data.id);
  let saved=await pool.query(`UPDATE users SET email=$1,name=$2,role=$3::user_role WHERE clerk_user_id=$4 RETURNING id::text,organization_id::text,email,name,role`,[primary,name,role,clerkUserId]);
  if(!saved.rowCount)saved=await pool.query(`INSERT INTO users(id,organization_id,email,name,role,clerk_user_id) VALUES($1,$2,$3,$4,$5::user_role,$6) ON CONFLICT(organization_id,email) DO UPDATE SET name=EXCLUDED.name,role=EXCLUDED.role,clerk_user_id=EXCLUDED.clerk_user_id RETURNING id::text,organization_id::text,email,name,role`,[asUuid(clerkUserId),demoOrganizationUuid,primary,name,role,clerkUserId]);
  const row=saved.rows[0] as {id:string;organization_id:string;email:string;name:string;role:Role};syncMemoryUser({id:row.id,organizationId:row.organization_id===demoOrganizationUuid?demoOrganizationId:row.organization_id,email:row.email,name:row.name,role:row.role});
  return {synced:true,type:payload.type};
}
