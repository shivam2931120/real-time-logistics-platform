import type { Role, User } from '@routepulse/shared';
import { pool } from '../db/client.js';
import { users } from '../domain/store.js';
import { asUuid, demoOrganizationId, demoOrganizationUuid } from '../db/persistence.js';

const roles: Role[] = ['admin', 'dispatcher', 'driver', 'customer'];
const validRole = (value: unknown): Role => roles.includes(value as Role) ? value as Role : 'customer';

export type ClerkUserProfile = {
  clerkUserId: string;
  email: string;
  name: string;
  role: unknown;
};

export async function upsertClerkUser(profile: ClerkUserProfile): Promise<User> {
  const user: User = {
    id: profile.clerkUserId,
    organizationId: demoOrganizationId,
    email: profile.email,
    name: profile.name || profile.email.split('@')[0] || 'RoutePulse user',
    role: validRole(profile.role),
  };
  if (!pool) return user;

  let saved = await pool.query(
    `UPDATE users SET email=$1,name=$2,role=$3::user_role WHERE clerk_user_id=$4
     RETURNING id::text,organization_id::text,email,name,role`,
    [user.email, user.name, user.role, profile.clerkUserId],
  );
  if (!saved.rowCount) {
    saved = await pool.query(
      `INSERT INTO users(id,organization_id,email,name,role,clerk_user_id)
       VALUES($1,$2,$3,$4,$5::user_role,$6)
       ON CONFLICT(organization_id,email) DO UPDATE SET
       name=EXCLUDED.name,role=EXCLUDED.role,clerk_user_id=EXCLUDED.clerk_user_id
       RETURNING id::text,organization_id::text,email,name,role`,
      [asUuid(profile.clerkUserId), demoOrganizationUuid, user.email, user.name, user.role, profile.clerkUserId],
    );
  }
  const row = saved.rows[0] as { id: string; organization_id: string; email: string; name: string; role: Role };
  const synced: User = { id: row.id, organizationId: row.organization_id === demoOrganizationUuid ? demoOrganizationId : row.organization_id, email: row.email, name: row.name, role: validRole(row.role) };
  const index = users.findIndex(candidate => candidate.id === synced.id);
  if (index >= 0) users[index] = synced; else users.push(synced);
  return synced;
}
