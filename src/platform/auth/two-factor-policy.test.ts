import { describe, expect, it } from "vitest";
import { twoFactorSetupRequired } from "./two-factor-policy";

describe("twoFactorSetupRequired", () => {
  it("asks a password account without TOTP when the policy requires it", () => {
    expect(twoFactorSetupRequired({ policy: "required", twoFactorEnabled: false, hasPassword: true })).toBe(
      true,
    );
  });

  it("lets through an account that already has TOTP", () => {
    expect(twoFactorSetupRequired({ policy: "required", twoFactorEnabled: true, hasPassword: true })).toBe(
      false,
    );
  });

  it("never asks an Authentik-only account: its second factor is Authentik's", () => {
    expect(twoFactorSetupRequired({ policy: "required", twoFactorEnabled: false, hasPassword: false })).toBe(
      false,
    );
  });

  it("asks nobody when the policy is optional", () => {
    expect(twoFactorSetupRequired({ policy: "optional", twoFactorEnabled: false, hasPassword: true })).toBe(
      false,
    );
  });
});
