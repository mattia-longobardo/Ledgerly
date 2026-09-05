export const PERMISSIONS = [
  "accounts.read",
  "accounts.write",
  "accounts.delete",
  "finance.manage",
  "integrations.manage",
  "jobs.run",
  "expenses.read",
  "expenses.write",
  "interests.read",
  "interests.write",
  "admin.users",
  "admin.audit",
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export type RoleCode = "owner" | "admin" | "member" | "viewer";

const ROLE_PERMISSIONS: Record<RoleCode, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS,
  member: [
    "accounts.read", "accounts.write", "accounts.delete",
    "finance.manage", "integrations.manage", "jobs.run",
    "expenses.read", "expenses.write", "interests.read", "interests.write",
  ],
  viewer: ["accounts.read", "expenses.read", "interests.read"],
};

export function permissionsForRoles(roles: readonly RoleCode[]): ReadonlySet<Permission> {
  return new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []));
}
