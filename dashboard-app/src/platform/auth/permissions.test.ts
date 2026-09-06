import { describe, expect, it } from "vitest";
import { PERMISSIONS, permissionsForRoles } from "./permissions";

describe("funds permissions", () => {
  it("allows members to maintain funds and viewers only to read them", () => {
    expect([...permissionsForRoles(["member"])]).toEqual(expect.arrayContaining(["funds.read", "funds.write"]));
    expect([...permissionsForRoles(["viewer"])]).toContain("funds.read");
    expect([...permissionsForRoles(["viewer"])]).not.toContain("funds.write");
    expect([...permissionsForRoles(["owner"])]).toEqual(expect.arrayContaining(["funds.read", "funds.write"]));
    expect([...permissionsForRoles(["admin"])]).toEqual(expect.arrayContaining(["funds.read", "funds.write"]));
  });
});

describe("payroll permissions", () => {
  it("declares all four codes the payroll module asserts", () => {
    for (const code of ["payroll.read", "payroll.upload", "payroll.review", "payroll.read_original"] as const) {
      expect(PERMISSIONS).toContain(code);
    }
  });

  it("gives a member every payroll right and a viewer only the read (Ruling R4-17)", () => {
    const member = permissionsForRoles(["member"]);
    expect(member.has("payroll.upload")).toBe(true);
    expect(member.has("payroll.read_original")).toBe(true);
    const viewer = permissionsForRoles(["viewer"]);
    expect(viewer.has("payroll.read")).toBe(true);
    expect(viewer.has("payroll.read_original")).toBe(false);
    expect(viewer.has("payroll.upload")).toBe(false);
    expect(viewer.has("payroll.review")).toBe(false);
  });

  it("gives an owner everything, unchanged", () => {
    expect(permissionsForRoles(["owner"]).size).toBe(PERMISSIONS.length);
  });
});
