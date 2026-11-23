import { describe, expect, it } from "vitest";
import { editResponseSchema, pushRequestSchema, sourceMovementsResponseSchema } from "./calls-source";
import { acceptsContract } from "./manifest";

const movement = {
  externalId: "r1",
  accountExternalId: "a1",
  counterpartExternalId: null,
  day: "2026-01-02",
  instant: null,
  amount: "-12.30",
  currency: "EUR",
  payee: null,
  note: null,
  sentKey: null,
  category: null,
  labels: [],
  type: null,
  state: null,
};

const push = {
  credentials: { token: "t" },
  idempotencyKey: "0198a1b2-c3d4",
  askedOn: null,
  movement: {
    accountExternalId: "a1",
    day: "2026-01-02",
    amount: "-12.30",
    payee: null,
    note: null,
    categoryExternalId: null,
  },
};

describe("contract 2, a source read with a token", () => {
  it("is a contract the core speaks, beside 1", () => {
    expect(acceptsContract("1")).toBe(true);
    expect(acceptsContract("2")).toBe(true);
    expect(acceptsContract("3")).toBe(false);
  });

  it("takes an amount as a decimal text and never as a number", () => {
    expect(sourceMovementsResponseSchema.safeParse({ movements: [movement] }).success).toBe(true);
    const asNumber = { movements: [{ ...movement, amount: -12.3 }] };
    expect(sourceMovementsResponseSchema.safeParse(asNumber).success).toBe(false);
  });

  it("refuses a push without its idempotency key", () => {
    expect(pushRequestSchema.safeParse(push).success).toBe(true);
    const unkeyed: Partial<typeof push> = { ...push };
    delete unkeyed.idempotencyKey;
    expect(pushRequestSchema.safeParse(unkeyed).success).toBe(false);
  });

  it("says why an edit was refused with a code, never the provider's words", () => {
    expect(editResponseSchema.safeParse({ state: "refused", reason: "gone" }).success).toBe(true);
    expect(editResponseSchema.safeParse({ state: "refused", reason: "Wallet said no" }).success).toBe(false);
  });
});
