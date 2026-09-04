import { describe, expect, it } from "vitest";
import { permissionsForRoles } from "./permissions";
import { assertPermission, PermissionDeniedError, type Principal } from "./principal";

const base = (roles: Principal["roles"]): Principal => ({
  userId: "u1",
  organizationId: "o1",
  roles,
  permissions: permissionsForRoles(roles),
});

describe("permissions", () => {
  it("viewer can read accounts but not write", () => {
    const p = base(["viewer"]);
    expect(p.permissions.has("accounts.read")).toBe(true);
    expect(p.permissions.has("accounts.write")).toBe(false);
  });
  it("owner has every permission", () => {
    expect(base(["owner"]).permissions.size).toBe(12);
  });
  it("assertPermission throws a typed error", () => {
    expect(() => assertPermission(base(["viewer"]), "admin.users")).toThrow(PermissionDeniedError);
    expect(() => assertPermission(base(["admin"]), "admin.users")).not.toThrow();
  });
});
