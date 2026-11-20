import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "../accounts/service";
import type { Ctx } from "../../platform/context";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";
import { matchMovements, type MovementRule } from "./index";
import type { IncomingTransaction } from "./rules";
import { hideTransactions, upsertFromProvider } from "./service";

// The movement matcher (rewrite plan §10.11, E7) against the database: the account, the way, the
// types and the window go to the query; the text, the identifier and the amount to the rule.

async function newContext(): Promise<Ctx> {
  const user = await createTestUser();
  return {
    userId: user.id,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
}

async function anAccount(ctx: Ctx, name: string): Promise<string> {
  const account = await createAccount(ctx, {
    name,
    type: "checking",
    currency: "EUR",
    color: null,
    reference: "",
    iban: "",
    purpose: "",
    openedOn: null,
    notes: "",
    openingBalance: null,
  });
  return account.id;
}

function movement(externalId: string, overrides: Partial<IncomingTransaction> = {}): IncomingTransaction {
  return {
    externalId,
    counterpartExternalId: null,
    occurredAt: new Date("2026-03-10T09:00:00Z"),
    amountCents: -100_00n,
    currency: "EUR",
    type: "expense",
    state: "cleared",
    payee: "SDD Fondo Pensione",
    note: "Mandato IT66ZZZ12345",
    categoryExternalId: null,
    categoryName: null,
    categoryGroupExternalId: null,
    categoryGroupName: null,
    labels: [],
    ...overrides,
  };
}

const MARCH = { from: "2026-03-01", to: "2026-03-31" };

let ctx: Ctx;
let bank: string;
let other: string;

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  bank = await anAccount(ctx, "Bank");
  other = await anAccount(ctx, "Other");
  await upsertFromProvider(ctx, bank, [
    movement("debit"),
    movement("transfer", { type: "transfer", occurredAt: new Date("2026-03-12T09:00:00Z") }),
    movement("shop", { payee: "Esselunga", note: null, amountCents: -25_00n }),
    movement("refund", {
      type: "income",
      amountCents: 100_00n,
      occurredAt: new Date("2026-03-11T09:00:00Z"),
    }),
    // 23:30 UTC on 31 March is 1 April in Rome: outside the window.
    movement("april", { occurredAt: new Date("2026-03-31T23:30:00Z") }),
    movement("hidden", { occurredAt: new Date("2026-03-13T09:00:00Z") }),
  ]);
  await upsertFromProvider(ctx, other, [movement("elsewhere")]);
  const [hidden] = await matchMovements(ctx, {
    accountId: bank,
    sign: "out",
    window: { from: "2026-03-13", to: "2026-03-13" },
  });
  await hideTransactions(ctx, [hidden.id]);
});

afterAll(closeDatabase);

const rule = (overrides: Partial<MovementRule> = {}): MovementRule => ({
  accountId: bank,
  sign: "out",
  window: MARCH,
  ...overrides,
});
const days = (found: { on: string }[]) => found.map((one) => one.on);

describe("matchMovements", () => {
  it("reads the visible movements of the account, the way and the window, oldest first", async () => {
    const found = await matchMovements(ctx, rule());
    expect(days(found)).toEqual(["2026-03-10", "2026-03-10", "2026-03-12"]);
    expect(found.every((one) => one.accountId === bank && one.cents > 0n)).toBe(true);
  });

  it("reads every account when the rule names none", async () => {
    expect(await matchMovements(ctx, rule({ accountId: null }))).toHaveLength(4);
  });

  it("keeps the types asked for", async () => {
    expect(days(await matchMovements(ctx, rule({ types: ["transfer"] })))).toEqual(["2026-03-12"]);
  });

  it("reads money coming in, positive", async () => {
    const found = await matchMovements(ctx, rule({ sign: "in" }));
    expect(found.map((one) => [one.on, one.cents])).toEqual([["2026-03-11", 100_00n]]);
  });

  it("matches the payee text, the identifier in the bank's text and the amount", async () => {
    expect(await matchMovements(ctx, rule({ match: { by: "payee", text: "esselunga" } }))).toHaveLength(1);
    expect(
      days(
        await matchMovements(
          ctx,
          rule({ match: { by: "identifier", text: "IT66 ZZZ 12345" }, types: ["expense"] }),
        ),
      ),
    ).toEqual(["2026-03-10"]);
    expect(await matchMovements(ctx, rule({ amountCents: 25_00n }))).toHaveLength(1);
    expect(
      await matchMovements(ctx, rule({ amountCents: 25_00n, match: { by: "payee", text: "fondo" } })),
    ).toEqual([]);
  });

  it("never reads another person's movements", async () => {
    const stranger = await newContext();
    expect(await matchMovements(stranger, rule({ accountId: null }))).toEqual([]);
  });
});
