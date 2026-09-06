import type { Role, User } from '@routepulse/shared';
import { pool } from '../db/client.js';
import { demoOrganizationId, demoOrganizationUuid } from '../db/persistence.js';

type ClerkClaims = {
  sub?: string;
  org_id?: string;
  org_role?: string;
  role?: string;
  email?: string;
  name?: string;
  first_name?: string;
  metadata?: { role?: string };
  public_metadata?: { role?: string };
};

const validRoles: Role[] = ['admin', 'dispatcher', 'driver', 'customer'];
const organizationRoleMap: Record<string, Role> = {
  'org:admin': 'admin',
  'org:dispatcher': 'dispatcher',
  'org:driver': 'driver',
  'org:customer': 'customer',
};

const appRole = (value: unknown): Role | undefined =>
  validRoles.includes(value as Role) ? value as Role : undefined;

export function roleFromClerkClaims(claims: ClerkClaims): Role {
  return appRole(claims.role)
    || appRole(claims.metadata?.role)
    || appRole(claims.public_metadata?.role)
    || organizationRoleMap[String(claims.org_role || '')]
    || 'customer';
}

export async function resolveClerkUser(claims: ClerkClaims): Promise<User> {
  const clerkUserId = String(claims.sub || '');
  if (!clerkUserId) throw new Error('Clerk session is missing a subject');

  if (pool) {
    const result = await pool.query(
      `SELECT id::text,organization_id::text,email,name,role
       FROM users WHERE clerk_user_id=$1 LIMIT 1`,
      [clerkUserId],
    );
    const row = result.rows[0] as { id: string; organization_id: string; email: string; name: string; role: Role } | undefined;
    if (row) {
      return {
        id: row.id,
        organizationId: row.organization_id === demoOrganizationUuid ? demoOrganizationId : row.organization_id,
        email: row.email,
        name: row.name,
        role: appRole(row.role) || 'customer',
      };
    }
  }

  return {
    id: clerkUserId,
    organizationId: process.env.DEFAULT_ORGANIZATION_ID || claims.org_id || demoOrganizationId,
    name: String(claims.name || claims.first_name || 'RoutePulse user'),
    email: String(claims.email || ''),
    role: roleFromClerkClaims(claims),
  };
}
