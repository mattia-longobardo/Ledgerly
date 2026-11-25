import { describe, expect, it } from "vitest";
import { dateTimeOf, lineViewOf, type TransactionLine } from "./view";

/** A synthetic movement of `/api/v1`: an expense with no time of day. */
const LINE: TransactionLine = {
  id: "11111111-1111-4111-8111-111111111111",
  on: "2026-11-12",
  occurredAt: "2026-11-12T11:00:00.000Z",
  timeKnown: false,
  accountId: "22222222-2222-4222-8222-222222222222",
  accountName: "Everyday",
  amount: "-25.00",
  currency: "EUR",
  type: "expense",
  state: "cleared",
  categoryId: null,
  categoryName: null,
  payee: "Shop",
  note: null,
  labels: [],
  hidden: false,
  categoryColor: null,
  categoryState: "none",
  categoryReason: null,
  categoryIsOwn: true,
  suggestedCategoryId: null,
  labelIds: [],
  transferGroupId: null,
  transferOutside: false,
  transferAccountId: null,
  origin: "provider",
  sendState: null,
  sendSource: null,
  editableAtSource: false,
  removedUpstream: false,
  edited: false,
  badges: [],
  macros: ["expense"],
};

const SAVINGS = { id: "33333333-3333-4333-8333-333333333333", name: "Savings" };

const view = (line: Partial<TransactionLine>) =>
  lineViewOf(
    { ...LINE, ...line },
    {
      locale: "it",
      timeZone: "Europe/Rome",
      numberFormat: "it-IT",
      colorOf: new Map(),
      categories: [],
      accounts: [SAVINGS],
    },
  );

describe("the day and the time of a movement", () => {
  it("shows the time in the person's zone when the source gave it", () => {
    const row = view({ occurredAt: "2026-11-12T13:32:00.000Z", timeKnown: true });
    expect(dateTimeOf(row)).toBe("12 nov 2026 · 14:32");
  });

  it("shows the day alone, never the noon of convenience, when it did not", () => {
    const row = view({ timeKnown: false });
    expect(row.time).toBeNull();
    expect(dateTimeOf(row)).toBe("12 nov 2026");
  });
});

describe("the other side of a giroconto", () => {
  const transfer = { type: "transfer" as const, macros: [] };

  it("is none on an income or a spending", () => {
    expect(view({}).transfer).toBeNull();
  });

  it("reads the four states from the fields of the API", () => {
    expect(view({ ...transfer, transferGroupId: "g", transferAccountId: SAVINGS.id }).transfer).toEqual({
      state: "paired",
      otherId: SAVINGS.id,
      other: "Savings",
      out: true,
    });
    expect(view({ ...transfer, transferOutside: true }).transfer?.state).toBe("outside");
    expect(view({ ...transfer, transferAccountId: SAVINGS.id }).transfer?.state).toBe("waiting");
    expect(view({ ...transfer, amount: "25.00" }).transfer).toEqual({
      state: "choose",
      otherId: null,
      other: null,
      out: false,
    });
  });
});
