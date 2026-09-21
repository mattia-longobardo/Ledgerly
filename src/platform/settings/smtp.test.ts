import { describe, expect, it } from "vitest";
import { DEFAULT_MAIL_POLICY, encryptionFrom, mailPolicyFrom, smtpInputSchema, transportFlags } from "./smtp";

describe("transportFlags", () => {
  it("opens the socket in TLS for SSL/TLS and demands STARTTLS for STARTTLS", () => {
    expect(transportFlags("ssl")).toEqual({ secure: true, requireTLS: false });
    expect(transportFlags("starttls")).toEqual({ secure: false, requireTLS: true });
    expect(transportFlags("none")).toEqual({ secure: false, requireTLS: false });
  });

  it("round-trips through encryptionFrom", () => {
    for (const encryption of ["ssl", "starttls", "none"] as const) {
      expect(encryptionFrom(transportFlags(encryption))).toBe(encryption);
    }
  });
});

describe("mailPolicyFrom", () => {
  it("is every switch on while nothing is saved", () => {
    expect(mailPolicyFrom(null)).toEqual(DEFAULT_MAIL_POLICY);
    expect(mailPolicyFrom(undefined)).toEqual(DEFAULT_MAIL_POLICY);
    expect(mailPolicyFrom({})).toEqual(DEFAULT_MAIL_POLICY);
  });

  it("reads each switch on its own, defaulting the ones that are not booleans", () => {
    expect(mailPolicyFrom({ invitations: false, syncAlerts: "yes" })).toEqual({
      invitations: false,
      syncAlerts: true,
      monthlySummary: true,
    });
  });
});

describe("smtpInputSchema", () => {
  const valid = {
    host: "smtp.example",
    port: 465,
    encryption: "ssl" as const,
    user: "ledgerly@example",
    password: "",
    from: "Ledgerly <ledgerly@example>",
    invitations: true,
    syncAlerts: true,
    monthlySummary: false,
  };

  it("accepts an empty password: an empty field keeps the sealed one", () => {
    expect(smtpInputSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses a username with no encryption: credentials must not travel in plaintext", () => {
    expect(smtpInputSchema.safeParse({ ...valid, encryption: "none" }).success).toBe(false);
  });

  it("allows no encryption when there is no username either", () => {
    expect(smtpInputSchema.safeParse({ ...valid, user: "", encryption: "none" }).success).toBe(true);
  });

  it("refuses a port outside the range of a port", () => {
    expect(smtpInputSchema.safeParse({ ...valid, port: 0 }).success).toBe(false);
    expect(smtpInputSchema.safeParse({ ...valid, port: 70_000 }).success).toBe(false);
  });
});
