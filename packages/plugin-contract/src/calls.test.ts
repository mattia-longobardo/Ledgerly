import { describe, expect, it } from "vitest";
import { authStartResponseSchema, syncResponseSchema } from "./calls";

describe("authStartResponseSchema", () => {
  it("takes an https address only from a plugin", () => {
    expect(authStartResponseSchema.safeParse({ url: "https://bank.example/login?x=1" }).success).toBe(true);
    expect(authStartResponseSchema.safeParse({ url: "javascript:alert(1)" }).success).toBe(false);
    expect(authStartResponseSchema.safeParse({ url: "http://bank.example/login" }).success).toBe(false);
  });
});

describe("a movement of syncResponseSchema", () => {
  const movement = {
    accountExternalId: "u-1",
    externalId: null,
    status: "booked",
    bookingDate: "2026-11-10",
    valueDate: null,
    amount: "1.00",
    direction: "debit",
    currency: "EUR",
    text: [],
    counterparty: null,
    merchantCategoryCode: null,
    bankTransactionCode: null,
  };
  const valid = (one: object) =>
    syncResponseSchema.safeParse({
      accounts: [],
      transactions: [one],
      cursor: null,
      coverage: { from: null, to: null },
    }).success;

  it("stays valid without the operation's day and instant: a plugin written before them works", () => {
    expect(valid(movement)).toBe(true);
    expect(valid({ ...movement, transactionDate: null, instant: null })).toBe(true);
  });

  it("takes the operation's day as a date and the instant with its offset", () => {
    expect(valid({ ...movement, transactionDate: "2026-11-08", instant: "2026-11-08T13:32:00.000Z" })).toBe(
      true,
    );
    expect(valid({ ...movement, transactionDate: "08/11/2026" })).toBe(false);
    expect(valid({ ...movement, instant: "2026-11-08 14:32" })).toBe(false);
  });
});
