import { describe, expect, it } from "vitest";
import { normalizeTotp, recoveryCodesFile, totpSecretOf, twoFactorErrorKey } from "./two-factor";

describe("twoFactorErrorKey", () => {
  it("maps the plugin's codes to their messages", () => {
    expect(twoFactorErrorKey({ code: "INVALID_CODE" })).toBe("invalidCode");
    expect(twoFactorErrorKey({ code: "INVALID_BACKUP_CODE" })).toBe("invalidBackupCode");
    expect(twoFactorErrorKey({ code: "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE" })).toBe("tooManyAttempts");
    expect(twoFactorErrorKey({ code: "ACCOUNT_TEMPORARILY_LOCKED" })).toBe("locked");
    expect(twoFactorErrorKey({ code: "INVALID_TWO_FACTOR_COOKIE" })).toBe("expired");
    expect(twoFactorErrorKey({ code: "INVALID_PASSWORD" })).toBe("password");
  });

  it("reads a rate-limited answer by its status", () => {
    expect(twoFactorErrorKey({ status: 429 })).toBe("rateLimited");
  });

  it("falls back to the generic message", () => {
    expect(twoFactorErrorKey({ code: "SOMETHING_ELSE", status: 500 })).toBe("generic");
    expect(twoFactorErrorKey(null)).toBe("generic");
  });
});

describe("totpSecretOf", () => {
  it("reads the secret out of the otpauth URI, in groups of four", () => {
    expect(totpSecretOf("otpauth://totp/Ledgerly:a%40b.c?secret=JBSWY3DPEHPK3PXP&issuer=Ledgerly")).toBe(
      "JBSW Y3DP EHPK 3PXP",
    );
  });

  it("answers null for anything else", () => {
    expect(totpSecretOf("not a uri")).toBeNull();
    expect(totpSecretOf("otpauth://totp/Ledgerly")).toBeNull();
  });
});

describe("normalizeTotp", () => {
  it("drops the spaces and dashes people type", () => {
    expect(normalizeTotp(" 123 456 ")).toBe("123456");
    expect(normalizeTotp("123-456")).toBe("123456");
  });
});

describe("recoveryCodesFile", () => {
  it("lists every code on its own line", () => {
    const file = recoveryCodesFile(["aaaaa-bbbbb", "ccccc-ddddd"], "me@example.test");
    expect(file.split("\n")).toEqual([
      "Ledgerly recovery codes — me@example.test",
      "Each code works once.",
      "",
      "aaaaa-bbbbb",
      "ccccc-ddddd",
      "",
    ]);
  });
});
