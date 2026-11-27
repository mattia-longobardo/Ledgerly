// The basket plans (PERS-681, docs/design/investments-plans-whole-shares.md §8.1): the job proposes
// whole shares once however often it runs; a confirmation writes every purchase or none; what is not
// spent, and the whole budget of a skipped or expired execution, goes to the next one (M1, D2); fees
// stay outside the budget (D1); a missing price waits, then proposes the line to type; an instrument in
// another currency is bought at the ECB rate; a plan of R5d is converted with its amount to type.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "../../platform/context";
import { addDays, dayOfWeek, today } from "../../shared/dates";
import { getDb } from "../../platform/db/client";
import { saveRates } from "../../platform/fx/service";
import { createAccount } from "../accounts";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { accountMovement } from "../../../../../test/investments";
import { createTestUser } from "../../../../../test/users";
import { refreshPrices, searchInstruments } from "../instruments";
import { PRICE_SCALE, QUANTITY_SCALE } from "./rules";
import { parseDecimal } from "../../shared/money";
import {
  confirmBasketRun,
  createBasketPlan,
  createPlan,
  createPortfolioWithAccount,
  linkRunDebit,
  listPlans,
  listRuns,
  plansToDo,
  previewRun,
  recordOperation,
  runDuePlans,
  skipRun,
  updatePlan,
} from "./service";
import {
  investmentEvents,
  investmentOperations,
  investmentPlanInstruments,
  investmentPlanRuns,
  investmentPlans,
} from "./schema";

const price = (value: string) => parseDecimal(value, PRICE_SCALE);
const shares = (count: number) => BigInt(count) * 10n ** BigInt(QUANTITY_SCALE);

/** Registers that answer one instrument (invented ticker, name and currency) for any ISIN. */
const registers = (ticker: string, figi: string, currency: string, exchCode: string) =>
  (async (input: string | URL | Request) => {
    const figis = [{ data: [{ ticker, exchCode, shareClassFIGI: figi, securityType: "ETP" }] }];
    const firds = {
      response: {
        docs: [{ gnr_full_name: `Fund ${ticker}`, gnr_cfi_code: "CEOGLS", gnr_notional_curr_code: currency }],
      },
    };
    return new Response(JSON.stringify(new URL(String(input)).host === "api.openfigi.com" ? figis : firds));
  }) as typeof globalThis.fetch;

// Public example ISINs (ISO 6166); the registers and the source of the prices are fakes.
const ISINS = ["US0378331005", "US5949181045", "US0231351067"];

let ctx: Ctx;
let todayOn: string;
let markets: { instrumentId: string; listingId: string }[];

beforeEach(async () => {
  await resetDatabase();
  ctx = {
    userId: (await createTestUser()).id,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
  todayOn = today(ctx.timeZone);
  markets = [];
  // Two markets in euro on Borsa Italiana, one in dollars on Nasdaq.
  for (const [index, currency] of ["EUR", "EUR", "USD"].entries()) {
    const fetch = registers(`EX${index}`, `BBG00000000${index}`, currency, currency === "USD" ? "UW" : "IM");
    const [hit] = (await searchInstruments(ISINS[index], { fetch, priceSourceId: "prices" })).items;
    markets.push({ instrumentId: hit.instrumentId, listingId: hit.listings[0].listingId });
  }
});

afterAll(closeDatabase);
afterEach(() => vi.useRealTimers());

/** The closes of some markets on a day, in their currency. */
async function closes(on: string, prices: { market: number; close: string; currency?: string }[]) {
  const byListing = new Map(prices.map((one) => [markets[one.market].listingId, one]));
  await refreshPrices({
    source: {
      id: "prices",
      closes: async (request) => ({
        bars: request.listings.flatMap((one) => {
          const found = byListing.get(one.key);
          return found ? [{ key: one.key, on, close: found.close, currency: found.currency ?? "EUR" }] : [];
        }),
        errors: [],
      }),
    },
    markets: prices.map((one) => ({ listingId: markets[one.market].listingId, neededFrom: on })),
    today: on,
    cap: 10,
  });
}

async function portfolio(cents: bigint): Promise<string> {
  const { accountId } = await createPortfolioWithAccount(ctx, { name: "Broker", currency: "EUR", url: null });
  if (cents > 0n) await recordOperation(ctx, accountId, { kind: "deposit", on: todayOn, amountCents: cents });
  return accountId;
}

const instrument = (market: number, weightBp: number) => ({
  asset: { instrument: { instrumentId: markets[market].instrumentId, mic: market === 2 ? "XNAS" : "XMIL" } },
  weightBp,
});

/** A weekly basket due today: example 1 of the design, with two instruments. */
const weekly = (over: Record<string, unknown> = {}) => ({
  name: "Weekly basket",
  amountCents: 200_00n,
  instruments: [instrument(0, 6000), instrument(1, 4000)],
  frequency: "week" as const,
  day: dayOfWeek(todayOn) === 0 ? 7 : dayOfWeek(todayOn),
  startOn: todayOn,
  feeCents: 1_50n,
  ...over,
});

/** The confirmation of a proposal as the job made it. */
const confirmation = (lines: { assetId: string; quantity: string; price: string | null }[]) =>
  lines.map((line) => ({
    assetId: line.assetId,
    quantity: parseDecimal(line.quantity, QUANTITY_SCALE),
    unitPrice: parseDecimal(line.price ?? "0", PRICE_SCALE),
  }));

const runsOf = (planId: string) =>
  getDb().select().from(investmentPlanRuns).where(eq(investmentPlanRuns.planId, planId));

/** `now` a number of days from today, at noon in Rome. */
const daysFrom = (days: number) => new Date(`${addDays(todayOn, days)}T11:00:00Z`);

describe("a basket plan", () => {
  it("proposes whole shares once however often the job runs, and confirms them all, fees outside (D1)", async () => {
    await closes(todayOn, [
      { market: 0, close: "41.30" },
      { market: 1, close: "18.75" },
    ]);
    const accountId = await portfolio(1_000_00n);
    const { id: planId } = await createBasketPlan(ctx, accountId, weekly());
    await runDuePlans(ctx);
    await runDuePlans(ctx);
    const [run] = await listRuns(ctx, accountId, planId);
    expect(await runsOf(planId)).toHaveLength(1);
    // 120,00 € → 2 × 41,30; 80,00 € → 4 × 18,75: 157,60 spent, 42,40 carried.
    expect(run.run).toMatchObject({ state: "proposed", budgetCents: 200_00n, carryInCents: 0n });
    expect(run.lines.map((line) => [line.quantity, line.spentCents, line.state])).toEqual([
      ["2.000000000000000000", 82_60n, "buy"],
      ["4.000000000000000000", 75_00n, "buy"],
    ]);
    expect((await plansToDo(ctx)).toConfirm.map((fact) => fact.runId)).toEqual([run.run.id]);
    const ref = { accountId, planId, runId: run.run.id };
    const preview = await previewRun(ctx, ref, {
      lines: [{ assetId: run.lines[0].assetId, unitPrice: price("39") }],
    });
    expect(preview.lines[0]).toMatchObject({ quantity: shares(3), spentCents: 117_00n });
    expect(preview.carryOutCents).toBe(200_00n - 117_00n - 75_00n);
    const { eventIds } = await confirmBasketRun(ctx, ref, {
      lines: run.lines.map((line) => ({
        assetId: line.assetId,
        quantity: parseDecimal(line.quantity, QUANTITY_SCALE),
        unitPrice: parseDecimal(line.price ?? "0", PRICE_SCALE),
      })),
    });
    expect(eventIds).toHaveLength(2);
    const fees = await getDb().select().from(investmentOperations).where(eq(investmentOperations.leg, "fee"));
    expect(fees.map((leg) => leg.amountCents)).toEqual([-1_50n, -1_50n]);
    const [recorded] = await listRuns(ctx, accountId, planId);
    expect(recorded.run).toMatchObject({ state: "recorded", carryOutCents: 42_40n });
    expect(recorded.lines.every((line) => line.eventId !== null)).toBe(true);
    expect((await listPlans(ctx, accountId))[0]).toMatchObject({ carryCents: 42_40n, currency: "EUR" });
    await expect(confirmBasketRun(ctx, ref, { lines: [] })).rejects.toThrow();
    await expect(skipRun(ctx, ref)).rejects.toMatchObject({ code: "not_editable" });
  });

  it("writes nothing when the cash does not pay every purchase", async () => {
    await closes(todayOn, [
      { market: 0, close: "41.30" },
      { market: 1, close: "18.75" },
    ]);
    const accountId = await portfolio(100_00n);
    const { id: planId } = await createBasketPlan(ctx, accountId, weekly());
    await runDuePlans(ctx);
    const [run] = await listRuns(ctx, accountId, planId);
    await expect(
      confirmBasketRun(
        ctx,
        { accountId, planId, runId: run.run.id },
        {
          lines: run.lines.map((line) => ({
            assetId: line.assetId,
            quantity: parseDecimal(line.quantity, QUANTITY_SCALE),
            unitPrice: parseDecimal(line.price ?? "0", PRICE_SCALE),
          })),
        },
      ),
    ).rejects.toMatchObject({ code: "negative_cash" });
    const buys = await getDb()
      .select()
      .from(investmentOperations)
      .where(eq(investmentOperations.kind, "buy"));
    expect(buys).toHaveLength(0);
    const [still] = await listRuns(ctx, accountId, planId);
    expect(still.run.state).toBe("proposed");
    expect(still.lines.every((line) => line.eventId === null)).toBe(true);
  });

  it("carries the whole budget of a skipped execution, and of one left open, to the next (D2)", async () => {
    await closes(todayOn, [
      { market: 0, close: "41.30" },
      { market: 1, close: "18.75" },
    ]);
    const accountId = await portfolio(1_000_00n);
    const { id: skipped } = await createBasketPlan(ctx, accountId, weekly());
    const { id: open } = await createBasketPlan(ctx, accountId, weekly({ name: "Left open" }));
    await runDuePlans(ctx);
    const [first] = await listRuns(ctx, accountId, skipped);
    await skipRun(ctx, { accountId, planId: skipped, runId: first.run.id });
    // The proposal left open expires when the next one is made, with the closes of its day (§4.3).
    await closes(addDays(todayOn, 7), [
      { market: 0, close: "41.30" },
      { market: 1, close: "18.75" },
    ]);
    await runDuePlans(ctx, daysFrom(7));
    const [next, skippedRun] = await listRuns(ctx, accountId, skipped);
    expect(skippedRun.run).toMatchObject({ state: "skipped", carryOutCents: 200_00n });
    expect(next.run).toMatchObject({ carryInCents: 200_00n, budgetCents: 400_00n });
    const [later, expired] = await listRuns(ctx, accountId, open);
    expect(expired.run).toMatchObject({ state: "expired", carryOutCents: 200_00n });
    expect(later.run).toMatchObject({ carryInCents: 200_00n, budgetCents: 400_00n });
  });

  it("proposes each working day of a daily plan whose close comes the day after (§4.3)", async () => {
    const accountId = await portfolio(100_000_00n);
    const { id: planId } = await createBasketPlan(ctx, accountId, weekly({ frequency: "day" }));
    const workingDays: string[] = [];
    let confirmed = 0;
    for (let day = 0; day <= 7; day += 1) {
      const yesterday = addDays(todayOn, day - 1);
      if (day > 0 && dayOfWeek(yesterday) !== 0 && dayOfWeek(yesterday) !== 6) {
        workingDays.push(yesterday);
        await closes(yesterday, [
          { market: 0, close: "41.30" },
          { market: 1, close: "18.75" },
        ]);
      }
      // The confirmation of each day is no purchase in the future: the clock is on that day.
      vi.useFakeTimers({ toFake: ["Date"], now: daysFrom(day) });
      await runDuePlans(ctx);
      const proposed = (await listRuns(ctx, accountId, planId)).filter((one) => one.run.state === "proposed");
      expect(proposed.length).toBeLessThanOrEqual(1);
      if (proposed.length === 0) continue;
      const [run] = proposed;
      // The budget is the amount and the small carry of the purchase before: it does not grow.
      expect(run.run.budgetCents).toBeLessThan(2n * 200_00n);
      await confirmBasketRun(
        ctx,
        { accountId, planId, runId: run.run.id },
        { lines: confirmation(run.lines) },
      );
      confirmed += 1;
    }
    expect(confirmed).toBe(workingDays.length);
    const runs = await runsOf(planId);
    expect(runs.filter((run) => run.state === "expired")).toEqual([]);
  });

  it("refuses to skip an execution with no budget while the proposal before it is open (§4.3)", async () => {
    // A daily plan is due on working days: the first one from today, then the next one.
    const working = (from: number) => {
      let day = from;
      while ([0, 6].includes(dayOfWeek(addDays(todayOn, day)))) day += 1;
      return day;
    };
    const first = working(0);
    const second = working(first + 1);
    await closes(addDays(todayOn, first), [
      { market: 0, close: "41.30" },
      { market: 1, close: "18.75" },
    ]);
    const accountId = await portfolio(1_000_00n);
    const { id: planId } = await createBasketPlan(ctx, accountId, weekly({ frequency: "day" }));
    vi.useFakeTimers({ toFake: ["Date"], now: daysFrom(first) });
    await runDuePlans(ctx);
    // The next working day has no close yet: its execution waits for a price.
    vi.useFakeTimers({ toFake: ["Date"], now: daysFrom(second) });
    await runDuePlans(ctx);
    const [waiting, proposal] = await listRuns(ctx, accountId, planId);
    expect([waiting.run.state, proposal.run.state]).toEqual(["waiting_price", "proposed"]);
    await expect(skipRun(ctx, { accountId, planId, runId: waiting.run.id })).rejects.toMatchObject({
      code: "not_editable",
    });
    const [, still] = await listRuns(ctx, accountId, planId);
    expect(still.run).toMatchObject({ state: "proposed", carryOutCents: null });
    await confirmBasketRun(
      ctx,
      { accountId, planId, runId: proposal.run.id },
      { lines: confirmation(proposal.lines) },
    );
    // Closed, the proposal gives its carry out to the skip, which carries its whole budget.
    await skipRun(ctx, { accountId, planId, runId: waiting.run.id });
    const [skipped, recorded] = await listRuns(ctx, accountId, planId);
    expect(skipped.run).toMatchObject({
      state: "skipped",
      carryInCents: recorded.run.carryOutCents,
      carryOutCents: 200_00n + (recorded.run.carryOutCents ?? 0n),
    });
  });

  it("takes the ECB rate of the working day before for the fixed fee on a day with none", async () => {
    await saveRates([{ on: addDays(todayOn, -1), currency: "USD", eurPerUnit: "0.9" }]);
    await closes(todayOn, [{ market: 2, close: "30", currency: "USD" }]);
    const accountId = await portfolio(1_000_00n);
    const { id: planId } = await createBasketPlan(
      ctx,
      accountId,
      weekly({ amountCents: 100_00n, instruments: [instrument(2, 10000)] }),
    );
    await runDuePlans(ctx);
    const [run] = await listRuns(ctx, accountId, planId);
    await confirmBasketRun(ctx, { accountId, planId, runId: run.run.id }, { lines: confirmation(run.lines) });
    const fees = await getDb().select().from(investmentOperations).where(eq(investmentOperations.leg, "fee"));
    expect(fees.map((leg) => leg.amountCents)).toEqual([-1_50n]);
  });

  it("confirms a line set to 0 as skipped, and refuses a fraction of a share", async () => {
    await closes(todayOn, [
      { market: 0, close: "41.30" },
      { market: 1, close: "18.75" },
    ]);
    const accountId = await portfolio(1_000_00n);
    const { id: planId } = await createBasketPlan(ctx, accountId, weekly());
    await runDuePlans(ctx);
    const [run] = await listRuns(ctx, accountId, planId);
    const ref = { accountId, planId, runId: run.run.id };
    const half = shares(1) + shares(1) / 2n;
    await expect(
      previewRun(ctx, ref, { lines: [{ assetId: run.lines[0].assetId, quantity: half }] }),
    ).rejects.toMatchObject({ name: "ZodError" });
    const lines = confirmation(run.lines);
    await expect(
      confirmBasketRun(ctx, ref, { lines: [{ ...lines[0], quantity: half }, lines[1]] }),
    ).rejects.toMatchObject({ name: "ZodError" });
    const preview = await previewRun(ctx, ref, { lines: [{ assetId: run.lines[0].assetId, quantity: 0n }] });
    expect(preview.lines[0]).toMatchObject({ quantity: 0n, spentCents: 0n, state: "skipped" });
    const { eventIds } = await confirmBasketRun(ctx, ref, {
      lines: [{ ...lines[0], quantity: 0n }, lines[1]],
    });
    expect(eventIds).toHaveLength(1);
    const [recorded] = await listRuns(ctx, accountId, planId);
    expect(recorded.lines.map((line) => [line.quantity, line.spentCents, line.state, line.eventId])).toEqual([
      ["0.000000000000000000", 0n, "skipped", null],
      ["4.000000000000000000", 75_00n, "buy", eventIds[0]],
    ]);
    expect(recorded.run).toMatchObject({ state: "recorded", carryOutCents: 200_00n - 75_00n });
  });

  it("takes the plan's fixed fee in the plan's currency on an instrument in dollars", async () => {
    await saveRates([{ on: todayOn, currency: "USD", eurPerUnit: "0.9" }]);
    await closes(todayOn, [{ market: 2, close: "30", currency: "USD" }]);
    const accountId = await portfolio(1_000_00n);
    const { id: planId } = await createBasketPlan(
      ctx,
      accountId,
      weekly({ amountCents: 100_00n, instruments: [instrument(2, 10000)] }),
    );
    await runDuePlans(ctx);
    const [run] = await listRuns(ctx, accountId, planId);
    await confirmBasketRun(ctx, { accountId, planId, runId: run.run.id }, { lines: confirmation(run.lines) });
    const fees = await getDb().select().from(investmentOperations).where(eq(investmentOperations.leg, "fee"));
    // 1,50 € is 1,67 $ at the rate of the day, and 1,50 € again in the portfolio.
    expect(fees.map((leg) => leg.amountCents)).toEqual([-1_50n]);
  });

  it("waits for a missing price, then after 5 working days proposes the line to type", async () => {
    await closes(todayOn, [{ market: 1, close: "18.75" }]);
    const accountId = await portfolio(1_000_00n);
    const day = Number(todayOn.slice(8, 10));
    const { id: planId } = await createBasketPlan(ctx, accountId, weekly({ frequency: "month", day }));
    await runDuePlans(ctx);
    const [waiting] = await listRuns(ctx, accountId, planId);
    expect(waiting.run).toMatchObject({ state: "waiting_price", waitingSince: todayOn });
    expect(waiting.lines).toEqual([]);
    await runDuePlans(ctx, daysFrom(10));
    const [proposed] = await listRuns(ctx, accountId, planId);
    expect(proposed.run.state).toBe("proposed");
    expect(proposed.lines.map((line) => [line.state, line.quantity])).toEqual([
      ["price_missing", "0.000000000000000000"],
      ["buy", "4.000000000000000000"],
    ]);
    expect((await plansToDo(ctx)).priceMissing.map((fact) => fact.runId)).toEqual([proposed.run.id]);
  });

  /** A basket proposed with its first line with no price (§6): its reference, that line and the other typed. */
  async function proposalWithNoPrice() {
    await closes(todayOn, [{ market: 1, close: "18.75" }]);
    const accountId = await portfolio(1_000_00n);
    const day = Number(todayOn.slice(8, 10));
    const { id: planId } = await createBasketPlan(ctx, accountId, weekly({ frequency: "month", day }));
    await runDuePlans(ctx);
    await runDuePlans(ctx, daysFrom(10));
    const [proposed] = await listRuns(ctx, accountId, planId);
    const [missing, priced] = proposed.lines;
    expect(missing.state).toBe("price_missing");
    const ref = { accountId, planId, runId: proposed.run.id };
    const typed = { assetId: priced.assetId, quantity: shares(4), unitPrice: price("18.75") };
    return { accountId, planId, ref, missing, typed };
  }

  it("confirms a line with no price at 0 shares, its part carried; refuses shares with no price (§6)", async () => {
    const { accountId, planId, ref, missing, typed } = await proposalWithNoPrice();
    await expect(
      confirmBasketRun(ctx, ref, { lines: [{ assetId: missing.assetId, quantity: shares(1) }, typed] }),
    ).rejects.toMatchObject({ name: "ZodError" });
    const { eventIds } = await confirmBasketRun(ctx, ref, {
      lines: [{ assetId: missing.assetId, quantity: 0n }, typed],
    });
    expect(eventIds).toHaveLength(1);
    const [recorded] = await listRuns(ctx, accountId, planId);
    expect(recorded.lines.map((line) => [line.state, line.spentCents, line.eventId])).toEqual([
      ["price_missing", 0n, null],
      ["buy", 75_00n, eventIds[0]],
    ]);
    expect(recorded.run).toMatchObject({ state: "recorded", carryOutCents: 200_00n - 75_00n });
  });

  it("refuses a fee on a line with 0 shares, and takes a fee of 0 (PERS-729)", async () => {
    const { ref, missing, typed } = await proposalWithNoPrice();
    await expect(
      confirmBasketRun(ctx, ref, {
        lines: [{ assetId: missing.assetId, quantity: 0n, feeCents: 1_00n }, typed],
      }),
    ).rejects.toMatchObject({ name: "ZodError" });
    const { eventIds } = await confirmBasketRun(ctx, ref, {
      lines: [{ assetId: missing.assetId, quantity: 0n, feeCents: 0n }, typed],
    });
    expect(eventIds).toHaveLength(1);
  });

  it("proposes the bank movement of a recorded execution, purchases and fees, and links it (E7)", async () => {
    await closes(todayOn, [
      { market: 0, close: "41.30" },
      { market: 1, close: "18.75" },
    ]);
    const bank = await createAccount(ctx, {
      name: "Bank",
      type: "checking",
      currency: "EUR",
      openingBalance: null,
    });
    // 157,60 € of shares and 2 × 1,50 € of fees, in one bank movement.
    await accountMovement(ctx, bank.id, todayOn, -160_60n, { payee: "BROKER BASKET" });
    const accountId = await portfolio(1_000_00n);
    const { id: planId } = await createBasketPlan(ctx, accountId, weekly({ debitAccountId: bank.id }));
    await runDuePlans(ctx);
    const [proposed] = await listRuns(ctx, accountId, planId);
    // A proposal's lines and fees can still change: no match before the confirmation.
    expect(proposed.debit).toBeNull();
    const ref = { accountId, planId, runId: proposed.run.id };
    await expect(linkRunDebit(ctx, accountId, planId, ref.runId)).rejects.toMatchObject({
      code: "not_editable",
    });
    await confirmBasketRun(ctx, ref, { lines: confirmation(proposed.lines) });
    await runDuePlans(ctx);
    const [recorded] = await listRuns(ctx, accountId, planId);
    expect(recorded.debit).toMatchObject({ cents: 160_60n, payee: "BROKER BASKET", linked: false });
    await linkRunDebit(ctx, accountId, planId, ref.runId);
    const linked = await getDb()
      .select()
      .from(investmentEvents)
      .where(eq(investmentEvents.transactionId, recorded.debit!.transactionId));
    // One movement documents one event: the purchase of the heaviest line.
    expect(linked.map((event) => event.id)).toEqual([recorded.lines[0].eventId]);
    expect((await listRuns(ctx, accountId, planId))[0].debit?.linked).toBe(true);
    await expect(linkRunDebit(ctx, accountId, planId, ref.runId)).rejects.toMatchObject({
      code: "not_editable",
    });
  });

  it("buys an instrument in another currency at the ECB rate of the close", async () => {
    await saveRates([{ on: todayOn, currency: "USD", eurPerUnit: "0.9" }]);
    await closes(todayOn, [{ market: 2, close: "30", currency: "USD" }]);
    const accountId = await portfolio(1_000_00n);
    const { id: planId } = await createBasketPlan(
      ctx,
      accountId,
      weekly({ amountCents: 100_00n, instruments: [instrument(2, 10000)], feeCents: null }),
    );
    await runDuePlans(ctx);
    const [run] = await listRuns(ctx, accountId, planId);
    // One share is 27,00 €: 3 of them, 81,00 €, 19,00 € carried.
    expect(run.lines[0]).toMatchObject({
      quantity: "3.000000000000000000",
      spentCents: 81_00n,
      state: "buy",
    });
    await confirmBasketRun(
      ctx,
      { accountId, planId, runId: run.run.id },
      { lines: [{ assetId: run.lines[0].assetId, quantity: shares(3), unitPrice: price("30") }] },
    );
    const [recorded] = await listRuns(ctx, accountId, planId);
    expect(recorded.run).toMatchObject({ state: "recorded", carryOutCents: 19_00n });
  });

  it("converts a plan of R5d with migration 0084: its instrument at 100 %, the amount to type", async () => {
    await closes(todayOn, [{ market: 0, close: "40" }]);
    const accountId = await portfolio(1_000_00n);
    const { id: planId } = await createPlan(ctx, accountId, {
      name: "Weekly ETF",
      instrument: { instrumentId: markets[0].instrumentId, mic: "XMIL" },
      amountCents: 100_00n,
      frequency: "week",
      day: dayOfWeek(todayOn) === 0 ? 7 : dayOfWeek(todayOn),
      startOn: todayOn,
    });
    await runDuePlans(ctx);
    expect(await runsOf(planId)).toMatchObject([{ state: "proposed" }]);
    const migration = readFileSync(join(process.cwd(), "drizzle/0084_plan_baskets.sql"), "utf8");
    const conversion = migration.slice(migration.indexOf("-- PERS-681 §3.5"));
    for (const statement of conversion.split("--> statement-breakpoint")) {
      await getDb().execute(sql.raw(statement));
    }
    const [plan] = await getDb().select().from(investmentPlans).where(eq(investmentPlans.id, planId));
    expect(plan).toMatchObject({ model: "basket", executionAmountCents: null, amountCents: 100_00n });
    const instruments = await getDb().select().from(investmentPlanInstruments);
    expect(instruments).toMatchObject([{ planId, assetId: plan.assetId, weightBp: 10000 }]);
    expect(await runsOf(planId)).toMatchObject([{ state: "skipped", reason: "amount_missing" }]);
    expect((await plansToDo(ctx)).amountMissing).toEqual([{ planId, accountId }]);
    await runDuePlans(ctx, daysFrom(7));
    expect(await runsOf(planId)).toHaveLength(1);
    await updatePlan(ctx, accountId, planId, { amountCents: 150_00n });
    expect((await plansToDo(ctx)).amountMissing).toEqual([]);
    // The budget is fixed when the proposal is made, with the close of its day (§4.3).
    await closes(addDays(todayOn, 7), [{ market: 0, close: "40" }]);
    await runDuePlans(ctx, daysFrom(7));
    const runs = await listRuns(ctx, accountId, planId);
    // From the day the amount was typed: the due date of next week, with no carry.
    expect(runs[0].run).toMatchObject({ dueOn: addDays(todayOn, 7), carryInCents: 0n, budgetCents: 150_00n });
    expect(runs).toHaveLength(2);
  });

  it("refuses weights that do not make 100 % and a start in the past", async () => {
    const accountId = await portfolio(0n);
    await expect(
      createBasketPlan(ctx, accountId, weekly({ instruments: [instrument(0, 6000), instrument(1, 3000)] })),
    ).rejects.toThrow();
    await expect(createBasketPlan(ctx, accountId, weekly({ startOn: addDays(todayOn, -1) }))).rejects.toThrow(
      RangeError,
    );
    await expect(
      createBasketPlan(ctx, accountId, weekly({ instruments: [instrument(0, 5000), instrument(0, 5000)] })),
    ).rejects.toThrow(RangeError);
  });
});
