import { permissionsForRoles, type RoleCode } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";

export function testPrincipal(overrides: Partial<Omit<Principal, "permissions">> = {}): Principal {
  const roles: RoleCode[] = overrides.roles ?? ["owner"];
  return {
    userId: overrides.userId ?? "00000000-0000-7000-8000-000000000001",
    organizationId: overrides.organizationId ?? "00000000-0000-7000-8000-0000000000aa",
    roles,
    permissions: permissionsForRoles(roles),
  };
}
