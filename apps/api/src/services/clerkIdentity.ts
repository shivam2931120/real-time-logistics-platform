import { createClerkClient } from '@clerk/backend';
import type { Role, User } from '@routepulse/shared';
import { pool } from '../db/client.js';
import { asUuid, demoOrganizationId, demoOrganizationUuid } from '../db/persistence.js';
import { resolveOrganizationForClerkId, upsertClerkUser } from './clerkUserSync.js';

type ClerkClaims = {
  sub?: string;
  org_id?: string;
  org_name?: string;
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

  const organization = pool
    ? await resolveOrganizationForClerkId(claims.org_id, claims.org_name)
    : { organizationId: claims.org_id, clerkOrganizationId: claims.org_id, name: claims.org_name };
  const selectedOrganizationId =
    organization.organizationId || process.env.DEFAULT_ORGANIZATION_ID;
  const organizationUuid = selectedOrganizationId
    ? selectedOrganizationId === demoOrganizationId
      ? demoOrganizationUuid
      : asUuid(selectedOrganizationId)
    : undefined;

  if (pool) {
    const result = await pool.query(
      `SELECT id::text,organization_id::text,email,name,role
       FROM users WHERE clerk_user_id=$1
       ${organizationUuid ? 'AND organization_id=$2' : ''}
       ORDER BY created_at ASC LIMIT 1`,
      organizationUuid ? [clerkUserId, organizationUuid] : [clerkUserId],
    );
    const row = result.rows[0] as { id: string; organization_id: string; email: string; name: string; role: Role } | undefined;
    if (row) {
      const claimedRole = appRole(claims.role)
        || appRole(claims.metadata?.role)
        || appRole(claims.public_metadata?.role)
        || organizationRoleMap[String(claims.org_role || '')];
      if (claimedRole && claimedRole !== row.role) {
        await pool.query(
          `UPDATE users SET role=$1::user_role WHERE id=$2 AND organization_id=$3`,
          [claimedRole, row.id, row.organization_id],
        );
      }
      return {
        id: row.id,
        organizationId: row.organization_id === demoOrganizationUuid ? demoOrganizationId : row.organization_id,
        email: row.email,
        name: row.name,
        role: claimedRole || appRole(row.role) || 'customer',
      };
    }

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (secretKey) {
      const clerkUser = await createClerkClient({ secretKey }).users.getUser(clerkUserId);
      const email = clerkUser.emailAddresses.find(address => address.id === clerkUser.primaryEmailAddressId)?.emailAddress
        || clerkUser.emailAddresses[0]?.emailAddress
        || '';
      return upsertClerkUser({
        clerkUserId,
        email,
        name: [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || email.split('@')[0] || 'RoutePulse user',
        role: roleFromClerkClaims({
          ...claims,
          role: (clerkUser.publicMetadata as { role?: unknown }).role as string | undefined,
        }),
        organizationId: selectedOrganizationId,
        clerkOrganizationId: claims.org_id,
        organizationName: organization.name,
      });
    }
  }

  return {
    id: clerkUserId,
    organizationId: selectedOrganizationId || demoOrganizationId,
    name: String(claims.name || claims.first_name || 'RoutePulse user'),
    email: String(claims.email || ''),
    role: roleFromClerkClaims(claims),
  };
}
