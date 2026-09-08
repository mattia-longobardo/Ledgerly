import { and, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { userIdentities, userRoles, users } from "@/lib/db/schema";
import { permissionsForRoles, type Permission, type RoleCode } from "./permissions";

export interface Principal {
  userId: string;
  organizationId: string;
  roles: RoleCode[];
  permissions: ReadonlySet<Permission>;
}

export class PermissionDeniedError extends Error {
  readonly status = 403;
  constructor(readonly permission: Permission) {
    super(`Missing permission ${permission}`);
    this.name = "PermissionDeniedError";
  }
}

/** The user columns both resolvers select, so they share one shape. */
interface UserMatch {
  userId: string;
  organizationId: string;
  status: string;
}

/**
 * Everything after "we found the user": the active check, the role lookup and
 * the permission resolution. Both resolvers below end here, so a change to
 * how a principal is built cannot apply to one entry point and not the other.
 */
async function principalFor(db: DbClient, match: UserMatch | undefined): Promise<Principal | null> {
  if (!match || match.status !== "active") return null;
  const roleRows = await db
    .select({ code: userRoles.roleCode })
    .from(userRoles)
    .where(eq(userRoles.userId, match.userId));
  const roles = roleRows.map((r) => r.code as RoleCode);
  return {
    userId: match.userId,
    organizationId: match.organizationId,
    roles,
    permissions: permissionsForRoles(roles),
  };
}

export async function resolvePrincipal(
  db: DbClient,
  identity: { provider: string; subject: string },
): Promise<Principal | null> {
  const [match] = await db
    .select({ userId: users.id, organizationId: users.organizationId, status: users.status })
    .from(userIdentities)
    .innerJoin(users, eq(users.id, userIdentities.userId))
    .where(and(eq(userIdentities.provider, identity.provider), eq(userIdentities.subject, identity.subject)))
    .limit(1);
  return principalFor(db, match);
}

/**
 * The same resolution keyed on `users.id` rather than on an external identity.
 *
 * A personal access token names its owner directly (`personal_access_tokens.
 * user_id`), so Bearer authentication has no provider/subject pair to look up
 * — but it must still get exactly the principal the cookie path would have
 * produced, including the suspended-user refusal. Hence one shared
 * `principalFor` rather than a second, drifting copy of the role join.
 */
export async function resolvePrincipalByUserId(db: DbClient, userId: string): Promise<Principal | null> {
  const [match] = await db
    .select({ userId: users.id, organizationId: users.organizationId, status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return principalFor(db, match);
}

export function assertPermission(p: Principal, permission: Permission): void {
  if (!p.permissions.has(permission)) throw new PermissionDeniedError(permission);
}
