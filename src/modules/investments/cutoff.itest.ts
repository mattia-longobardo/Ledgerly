// PERS-145 (rules 1, 2, 4): the cut-off of a synced service against a real database. The clean-up
// removes only what a synced service holds before its cut-off; a Wallet manager account and a manual
// service do not change by one row; the cash of the cut-off becomes its opening; a difference of the
// cash becomes an entry of its own; a second run changes nothing.
import { and, count, eq, lt } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { listBalanceEntries } from "@/modules/accounts/queries";
import { createAccount, saveBalanceEntry } from "@/modules/accounts/service";
import type { Ctx } from "@/platform/context";
import { addDays, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { saveRates } from "@/platform/fx/service";
import type { InvestmentSource, ProviderEvent } from "@/platform/integrations/investments/source";
import { providerLinks } from "@/platform/integrations/schema";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import { GAP_NOTES } from "./cutoff";
import { investmentsPnl } from "./queries";
import {
  investmentAccounts,
  investmentEvents,
  investmentHoldings,
  investmentOperations,
  investmentReadings,
} from "./schema";
import { createManualService, insertEvent, recordOperation } from "./service";
import { connectInvestmentProvider, setSourcesForTests, settleCutoff } from "./sync";

const KEYS = { api_key: "pers145-etoro-api-key-0001", user_key: "pers145-etoro-user-key-0001" };

let ctx: Ctx;
let todayOn: string;
let cutoff: string;

const apple = {
  externalId: "instrument:1001",
  class: "stock" as const,
  name: "Apple",
  symbol: "AAPL",
  currency: "USD",
};

/** A closed eToro trade on `on`: a buy and a close the same day, 100 in, 110 back. */
function trade(id: number, on: string): ProviderEvent[] {
  const leg = (kind: "buy" | "close", amount: string) => ({
    leg: "base" as const,
    kind,
    asset: apple,
    product: "trading",
    quantity: "1",
    unitPrice: amount,
    priceCurrency: "USD",
    nativeAmount: amount,
    nativeCurrency: "USD",
  });
  return [
    {
      externalId: `trade:${id}:open`,
      occurredAt: new Date(`${on}T10:00:00Z`),
      note: null,
      legs: [leg("buy", "100")],
    },
    {
      externalId: `trade:${id}:close`,
      occurredAt: new Date(`${on}T15:00:00Z`),
      note: null,
      legs: [leg("close", "110")],
    },
  ];
}

function source(): InvestmentSource {
  return {
    async verifyReadOnly() {
      return {
        result: "read-only",
        permissions: { "etoro-public:trade.real:read": true },
        ipRestricted: null,
        externalAccountId: "900001",
      };
    },
    async fetchHoldings(_credentials, _currency, now) {
      return {
        observedAt: now,
        externalAccountId: "900001",
        totalCents: 1_033n,
        cashCents: null,
        positions: [],
        scopes: [{ product: "trading", complete: true }],
        empty: false,
        complete: true,
      };
    },
    async fetchFlows(_credentials, now) {
      // Trades of 2021 (before the cut-off: the API gives them, the service never keeps them) and
      // one inside the 12 months.
      return {
        events: [...trade(1, "2021-03-04"), ...trade(2, "2021-05-06"), ...trade(3, addDays(todayOn, -30))],
        coverage: [
          {
            stream: "trades",
            fromAt: new Date("2020-01-01T00:00:00Z"),
            toAt: now,
            status: "complete",
            reason: null,
          },
        ],
      };
    },
    async fetchHistory(_credentials, _currency, now) {
      // 0.33 every day from the cut-off, then 10.33 after the trade's 10 of profit.
      const points = [];
      for (let on = cutoff; on < todayOn; on = addDays(on, 1))
        points.push({ on, totalCents: on < addDays(todayOn, -30) ? 33n : 1_033n });
      return {
        points,
        coverage: [
          {
            stream: "balance_history",
            fromAt: new Date(`${cutoff}T00:00:00Z`),
            toAt: now,
            status: "complete",
            reason: null,
          },
        ],
      };
    },
  };
}

beforeEach(async () => {
  await resetDatabase();
  ctx = {
    userId: (await createTestUser()).id,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "USD",
  };
  todayOn = today(ctx.timeZone);
  cutoff = addDays(todayOn, -360);
  setSourcesForTests(() => source());
  const rates = [];
  for (let on = "2020-01-01"; on <= todayOn; on = addDays(on, 7))
    rates.push({ on, currency: "USD", eurPerUnit: "0.9" });
  await saveRates(rates);
});

afterEach(() => setSourcesForTests(null));
afterAll(closeDatabase);

async function investmentOf(accountId: string) {
  const [one] = await getDb()
    .select()
    .from(investmentAccounts)
    .where(eq(investmentAccounts.accountId, accountId));
  return one;
}

/** Every row a person owns in the tables an account's data live in, by account. */
async function rowsOf(accountId: string) {
  const investment = await investmentOf(accountId);
  const entries = { n: (await listBalanceEntries(ctx, accountId, 10_000)).length };
  if (!investment) return { entries: entries.n };
  const [events] = await getDb()
    .select({ n: count() })
    .from(investmentEvents)
    .where(eq(investmentEvents.investmentAccountId, investment.id));
  const [legs] = await getDb()
    .select({ n: count() })
    .from(investmentOperations)
    .innerJoin(investmentEvents, eq(investmentEvents.id, investmentOperations.eventId))
    .where(eq(investmentEvents.investmentAccountId, investment.id));
  const [readings] = await getDb()
    .select({ n: count() })
    .from(investmentReadings)
    .where(eq(investmentReadings.investmentAccountId, investment.id));
  const [holdings] = await getDb()
    .select({ n: count() })
    .from(investmentHoldings)
    .where(eq(investmentHoldings.investmentAccountId, investment.id));
  return { entries: entries.n, events: events.n, legs: legs.n, readings: readings.n, holdings: holdings.n };
}

/** What a service connected before PERS-145 kept: events and a reading older than its cut-off. */
async function legacyRows(accountId: string) {
  const investment = await investmentOf(accountId);
  await getDb().transaction(async (tx) => {
    for (const on of ["2021-01-04", "2023-09-12"]) {
      await insertEvent(ctx, tx, investment.id, {
        on,
        occurredAt: new Date(`${on}T12:00:00Z`),
        origin: "provider",
        legs: [{ leg: "main", kind: "deposit", amountCents: 5_000n }],
      });
    }
  });
  await getDb()
    .insert(investmentReadings)
    .values({
      userId: ctx.userId,
      investmentAccountId: investment.id,
      on: addDays(cutoff, -10),
      observedAt: new Date(`${addDays(cutoff, -10)}T23:59:59Z`),
      status: "complete",
      totalCents: 99n,
    });
}

describe("settleCutoff (PERS-145)", () => {
  it("removes only what a synced service holds before its cut-off; a Wallet manager account and a manual service do not change", async () => {
    // A Wallet manager account and a manual service, with data older than any cut-off.
    const wallet = await createAccount(ctx, { name: "Conto corrente", type: "checking", currency: "EUR" });
    await saveBalanceEntry(ctx, wallet.id, { on: "2021-01-04", cents: 10_000n });
    await saveBalanceEntry(ctx, wallet.id, { on: addDays(todayOn, -1), cents: 12_000n });
    const { accountId: manual } = await createManualService(ctx, {
      target: "new",
      name: "Directa",
      category: "broker",
      currency: "EUR",
      mode: "total",
      url: null,
    });
    await recordOperation(ctx, manual, { kind: "deposit", on: todayOn, amountCents: 50_000n });

    const { accountId } = await connectInvestmentProvider(ctx, "etoro", KEYS, {
      kind: "new",
      name: "eToro",
      currency: "USD",
    });
    expect((await investmentOf(accountId)).managedSince).toBe(cutoff);
    await legacyRows(accountId);
    const walletBefore = await rowsOf(wallet.id);
    const manualBefore = await rowsOf(manual);
    const before = await rowsOf(accountId);

    const settled = await settleCutoff(ctx, accountId);
    expect(settled).toMatchObject({ cutoff, events: 2, readings: 1 });

    // Nothing older than the cut-off is left of the synced service; what is inside it stays.
    const investment = await investmentOf(accountId);
    const [old] = await getDb()
      .select({ n: count() })
      .from(investmentEvents)
      .where(and(eq(investmentEvents.investmentAccountId, investment.id), lt(investmentEvents.on, cutoff)));
    expect(old.n).toBe(0);
    const [oldReadings] = await getDb()
      .select({ n: count() })
      .from(investmentReadings)
      .where(
        and(eq(investmentReadings.investmentAccountId, investment.id), lt(investmentReadings.on, cutoff)),
      );
    expect(oldReadings.n).toBe(0);
    const after = await rowsOf(accountId);
    expect(after.readings).toBe(before.readings! - 1);
    // The 2021 trades never got in: the sync keeps the 12 months only (rule 1).
    const links = await getDb().select().from(providerLinks).where(eq(providerLinks.provider, "etoro"));
    expect(
      links
        .map((one) => one.externalId)
        .filter((id) => id.startsWith("trade:1:") || id.startsWith("trade:2:")),
    ).toEqual([]);
    expect(links.map((one) => one.externalId)).toEqual(
      expect.arrayContaining(["trade:3:open", "trade:3:close"]),
    );

    // The other accounts: not one row more or less.
    expect(await rowsOf(wallet.id)).toEqual(walletBefore);
    expect(await rowsOf(manual)).toEqual(manualBefore);

    // Idempotent: a second run finds nothing to do, and changes nothing.
    const again = await settleCutoff(ctx, accountId);
    expect(again).toMatchObject({ events: 0, readings: 0, holdings: 0, openingCents: null, gaps: 0 });
    expect(await rowsOf(accountId)).toEqual(after);
    expect(await rowsOf(wallet.id)).toEqual(walletBefore);
  });

  it("opens the cash of the cut-off as a flow, and the year closes with nothing unexplained", async () => {
    const { accountId } = await connectInvestmentProvider(ctx, "etoro", KEYS, {
      kind: "new",
      name: "eToro",
      currency: "USD",
    });
    // The pass of the connection settled it already: the opening is there, once.
    const investment = await investmentOf(accountId);
    const openings = await getDb()
      .select({
        note: investmentEvents.note,
        on: investmentEvents.on,
        amount: investmentOperations.amountCents,
      })
      .from(investmentEvents)
      .innerJoin(investmentOperations, eq(investmentOperations.eventId, investmentEvents.id))
      .where(
        and(
          eq(investmentEvents.investmentAccountId, investment.id),
          eq(investmentOperations.kind, "opening_cash"),
        ),
      );
    expect(openings).toEqual([{ note: GAP_NOTES.opening, on: cutoff, amount: 33n }]);
    expect(await settleCutoff(ctx, accountId)).toMatchObject({ openingCents: null, gaps: 0 });

    const { portfolio } = await investmentsPnl(ctx, { period: "all" });
    const pnl = portfolio.services.find((one) => one.accountId === accountId)!;
    expect(pnl).toMatchObject({
      status: "verified",
      partial: false,
      from: cutoff,
      startCents: 0n,
      openPositions: 0,
    });
    expect(pnl.local).toMatchObject({
      realizedCents: 1_000n,
      unrealizedChangeCents: 0n,
      unattributedCents: 0n,
    });
  });

  it("books a difference of the cash no entry explains as an entry with a name and a day (rule 4)", async () => {
    const { accountId } = await connectInvestmentProvider(ctx, "etoro", KEYS, {
      kind: "new",
      name: "eToro",
      currency: "USD",
    });
    // 2 $ go missing one day, with no entry: the reading says so, the book does not.
    const investment = await investmentOf(accountId);
    const day = addDays(todayOn, -100);
    await getDb()
      .update(investmentReadings)
      .set({ totalCents: 31n })
      .where(
        and(
          eq(investmentReadings.investmentAccountId, investment.id),
          lt(investmentReadings.on, addDays(todayOn, -30)),
        ),
      );
    await getDb()
      .update(investmentReadings)
      .set({ totalCents: 33n })
      .where(and(eq(investmentReadings.investmentAccountId, investment.id), lt(investmentReadings.on, day)));
    const settled = await settleCutoff(ctx, accountId);
    expect(settled.gaps).toBe(2);
    const gaps = await getDb()
      .select({
        note: investmentEvents.note,
        on: investmentEvents.on,
        kind: investmentOperations.kind,
        amount: investmentOperations.amountCents,
      })
      .from(investmentEvents)
      .innerJoin(investmentOperations, eq(investmentOperations.eventId, investmentEvents.id))
      .where(
        and(
          eq(investmentEvents.investmentAccountId, investment.id),
          eq(investmentEvents.note, GAP_NOTES.balance),
        ),
      )
      .orderBy(investmentEvents.on);
    // −2 the day the cash fell; +2 the day the trade's cash came back 2 more than its entries said.
    expect(gaps).toEqual([
      { note: GAP_NOTES.balance, on: day, kind: "fee", amount: -2n },
      { note: GAP_NOTES.balance, on: addDays(todayOn, -30), kind: "income", amount: 2n },
    ]);
    const { portfolio } = await investmentsPnl(ctx, { period: "all" });
    const pnl = portfolio.services.find((one) => one.accountId === accountId)!;
    expect(pnl.local?.unattributedCents).toBe(0n);
    expect(await settleCutoff(ctx, accountId)).toMatchObject({ gaps: 0 });
  });
});
