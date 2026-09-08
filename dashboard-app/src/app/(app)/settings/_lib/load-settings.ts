import { asc, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { organizations, userRoles, users } from "@/lib/db/schema";
import { assertPermission, type Principal } from "@/platform/auth/principal";
import type { RoleCode } from "@/platform/auth/permissions";

export interface ProfileView {
  displayName: string;
  email: string | null;
  locale: string;
  timezone: string;
  currency: string;
  organizationName: string;
  roles: RoleCode[];
}

export async function loadProfile(db: DbClient, principal: Principal): Promise<ProfileView> {
  const [row] = await db
    .select({
      displayName: users.displayName,
      email: users.email,
      locale: users.locale,
      timezone: users.timezone,
      currency: users.currency,
      organizationName: organizations.name,
    })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .where(eq(users.id, principal.userId))
    .limit(1);
  return {
    displayName: row?.displayName ?? "",
    email: row?.email ?? null,
    locale: row?.locale ?? "en-GB",
    timezone: row?.timezone ?? "Europe/Rome",
    currency: row?.currency ?? "EUR",
    organizationName: row?.organizationName ?? "",
    roles: principal.roles,
  };
}

export interface AdminUserView {
  id: string;
  displayName: string;
  email: string | null;
  status: string;
  roles: string[];
  createdAt: Date;
}

/**
 * Read-only, by design: this shows who exists. Invitations, role changes and
 * suspension are deferred with the rest of the user-lifecycle work (see
 * `docs/superpowers/DEFERRED.md`) — there is one user, and `AUTHORIZED_SUB`
 * is still the allowlist. The permission check comes first so a member who
 * guesses the URL never reaches a query.
 */
export async function loadUsers(db: DbClient, principal: Principal): Promise<AdminUserView[]> {
  assertPermission(principal, "admin.users");
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      status: users.status,
      createdAt: users.createdAt,
      roleCode: userRoles.roleCode,
    })
    .from(users)
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .orderBy(asc(users.createdAt));

  const byId = new Map<string, AdminUserView>();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (existing) {
      if (row.roleCode) existing.roles.push(row.roleCode);
      continue;
    }
    byId.set(row.id, {
      id: row.id,
      displayName: row.displayName,
      email: row.email,
      status: row.status,
      createdAt: row.createdAt,
      roles: row.roleCode ? [row.roleCode] : [],
    });
  }
  return [...byId.values()];
}

export interface SessionView {
  userAgent: string;
  ip: string | null;
  current: true;
}

/**
 * The one session this app can describe today. Auth.js still issues JWT
 * sessions, so there is no `sessions` table to list or revoke from — the
 * database session registry is deferred (Ruling R8-1, see
 * `docs/superpowers/DEFERRED.md`). Reporting the request's own device is
 * honest and useful; inventing a list would not be.
 */
export function describeCurrentSession(headers: Headers): SessionView {
  const forwarded = headers.get("x-forwarded-for");
  return {
    userAgent: headers.get("user-agent") ?? "Unknown device",
    ip: forwarded ? (forwarded.split(",")[0]?.trim() ?? null) : null,
    current: true,
  };
}
