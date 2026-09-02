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

export function assertPermission(p: Principal, permission: Permission): void {
  if (!p.permissions.has(permission)) throw new PermissionDeniedError(permission);
}
