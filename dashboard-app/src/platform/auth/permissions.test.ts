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

describe("budgets permissions", () => {
  it("allows members to maintain budgets and viewers only to read them", () => {
    expect([...permissionsForRoles(["member"])]).toEqual(expect.arrayContaining(["budgets.read", "budgets.write"]));
    expect([...permissionsForRoles(["viewer"])]).toContain("budgets.read");
    expect([...permissionsForRoles(["viewer"])]).not.toContain("budgets.write");
    expect([...permissionsForRoles(["owner"])]).toEqual(expect.arrayContaining(["budgets.read", "budgets.write"]));
    expect([...permissionsForRoles(["admin"])]).toEqual(expect.arrayContaining(["budgets.read", "budgets.write"]));
  });
});

describe("timeoff permissions", () => {
  it("declares both codes the timeoff module asserts", () => {
    for (const code of ["timeoff.read", "timeoff.write"] as const) {
      expect(PERMISSIONS).toContain(code);
    }
  });

  it("gives a member read and write and a viewer only the read", () => {
    const member = permissionsForRoles(["member"]);
    expect(member.has("timeoff.read")).toBe(true);
    expect(member.has("timeoff.write")).toBe(true);
    const viewer = permissionsForRoles(["viewer"]);
    expect(viewer.has("timeoff.read")).toBe(true);
    expect(viewer.has("timeoff.write")).toBe(false);
  });

  it("gives owner and admin both codes", () => {
    for (const role of ["owner", "admin"] as const) {
      expect([...permissionsForRoles([role])]).toEqual(
        expect.arrayContaining(["timeoff.read", "timeoff.write"]),
      );
    }
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
