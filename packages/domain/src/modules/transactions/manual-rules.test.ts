import { describe, expect, it } from "vitest";
import { civilDateIn } from "../../shared/dates";
import {
  isAfterToday,
  manualColumns,
  manualMovementSchema,
  manualOccurredAt,
  signedAmount,
} from "./manual-rules";

const ACCOUNT = "018f4e9a-0000-7000-8000-000000000001";
const base = {
  kind: "expense",
  amountCents: 450n,
  on: "2026-11-15",
  accountId: ACCOUNT,
  categoryId: null,
} as const;

describe("a manual movement as the dialog sends it", () => {
  it("takes money out or money in, never a giroconto", () => {
    expect(manualMovementSchema.safeParse({ ...base, kind: "income" }).success).toBe(true);
    expect(manualMovementSchema.safeParse({ ...base, kind: "transfer" }).success).toBe(false);
  });

  it("refuses an amount that is not greater than zero", () => {
    expect(manualMovementSchema.safeParse({ ...base, amountCents: 0n }).success).toBe(false);
    expect(manualMovementSchema.safeParse({ ...base, amountCents: -1n }).success).toBe(false);
  });

  it("refuses a day that is not a civil date", () => {
    expect(manualMovementSchema.safeParse({ ...base, on: "2026-02-30" }).success).toBe(false);
  });

  it("stores an empty payee and an empty note as none", () => {
    const parsed = manualMovementSchema.parse({ ...base, payee: "  ", note: "" });
    expect(parsed.payee).toBeNull();
    expect(parsed.note).toBeNull();
    expect(manualMovementSchema.parse({ ...base, payee: " Bar Centrale " }).payee).toBe("Bar Centrale");
  });

  it("refuses a payee longer than the field", () => {
    expect(manualMovementSchema.safeParse({ ...base, payee: "x".repeat(256) }).success).toBe(false);
  });
});

describe("the row of a manual movement", () => {
  it("signs the amount by its kind", () => {
    expect(signedAmount("expense", 450n)).toBe(-450n);
    expect(signedAmount("income", 450n)).toBe(450n);
  });

  it("falls on its own day in the person's zone, and in the zones around it", () => {
    for (const zone of ["Europe/Rome", "America/New_York", "Asia/Tokyo", "UTC"]) {
      expect(civilDateIn(manualOccurredAt("2026-03-29", zone), zone)).toBe("2026-03-29");
    }
    expect(civilDateIn(manualOccurredAt("2026-11-15", "Europe/Rome"), "UTC")).toBe("2026-11-15");
  });

  it("carries the account's currency and the kind as the type", () => {
    const row = manualColumns(manualMovementSchema.parse(base), "EUR", "Europe/Rome");
    expect(row).toMatchObject({ accountId: ACCOUNT, amountCents: -450n, currency: "EUR", type: "expense" });
  });

  it("says a day after today has not come", () => {
    expect(isAfterToday("2026-11-16", "2026-11-15")).toBe(true);
    expect(isAfterToday("2026-11-15", "2026-11-15")).toBe(false);
  });
});
