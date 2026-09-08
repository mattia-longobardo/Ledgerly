export const PERMISSIONS = [
  "accounts.read",
  "accounts.write",
  "accounts.delete",
  "funds.read",
  "funds.write",
  "budgets.read",
  "budgets.write",
  "finance.manage",
  "integrations.manage",
  "jobs.run",
  "expenses.read",
  "expenses.write",
  "interests.read",
  "interests.write",
  // Spec §8.2 names upload, review and read_original. `payroll.read` is Ruling
  // R4-17: spec §4 gates `/company/earnings` on data rather than on upload or
  // review rights, and reusing `payroll.upload` for a read would deny Earnings
  // to a viewer who may legitimately see figures but never a scanned original.
  "payroll.read",
  "payroll.upload",
  "payroll.review",
  "payroll.read_original",
  "timeoff.read",
  "timeoff.write",
  "admin.users",
  "admin.audit",
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export type RoleCode = "owner" | "admin" | "member" | "viewer";

const ROLE_PERMISSIONS: Record<RoleCode, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS,
  member: [
    "accounts.read", "accounts.write", "accounts.delete", "funds.read", "funds.write",
    "budgets.read", "budgets.write",
    "finance.manage", "integrations.manage", "jobs.run",
    "expenses.read", "expenses.write", "interests.read", "interests.write",
    "payroll.read", "payroll.upload", "payroll.review", "payroll.read_original",
    "timeoff.read", "timeoff.write",
  ],
  viewer: ["accounts.read", "funds.read", "budgets.read", "expenses.read", "interests.read", "payroll.read", "timeoff.read"],
};

export function permissionsForRoles(roles: readonly RoleCode[]): ReadonlySet<Permission> {
  return new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []));
}
