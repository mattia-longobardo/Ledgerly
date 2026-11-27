// The purchase plans (rewrite plan R5d, step 2; 03-releases.md, R5d second step): one instalment a due
// date and one purchase an instalment, whatever the job does twice; a proposal by default; an `auto`
// instalment with no cash becomes a proposal (P2); a plan writes purchases only (P1); a purchase from a
// plan is a purchase by hand; a synced service has no plan.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount, readingsAt } from "../accounts";
import type { Ctx } from "../../platform/context";
import { addDays, dayOfWeek, today } from "../../shared/dates";
import { refreshRecurrences } from "@/modules/transactions/jobs";
import { suggestions } from "../subscriptions";
import { getDb } from "../../platform/db/client";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";
import { accountMovement, manualService } from "../../../../../test/investments";
import { refreshPrices, searchInstruments } from "../instruments";
import { PRICE_SCALE, QUANTITY_SCALE } from "./rules";
import { parseDecimal } from "../../shared/money";
import {
  addAsset,
  backfillPlan,
  confirmRun,
  createPlan,
  convertToPortfolio,
  createPortfolioWithAccount,
  linkRunDebit,
  listPastRuns,
  listPlans,
  listRuns,
  plansToDo,
  recordOperation,
  runDuePlans,
  skipRun,
  updatePlan,
} from "./service";
import { investmentEvents, investmentOperations, investmentPlanRuns, investmentPlans } from "./schema";

const price = (value: string) => parseDecimal(value, PRICE_SCALE);
const qty = (value: string) => parseDecimal(value, QUANTITY_SCALE);

// A public example ISIN (ISO 6166); the registers and the source of the prices are fakes.
const ISIN = "US0378331005";
const REGISTERS = (async (input: string | URL | Request) => {
  const figi = [
    { data: [{ ticker: "EXA", exchCode: "IM", shareClassFIGI: "BBG000000001", securityType: "ETP" }] },
  ];
  const firds = {
    response: {
      docs: [{ gnr_full_name: "Example ETF", gnr_cfi_code: "CEOGLS", gnr_notional_curr_code: "EUR" }],
    },
  };
  return new Response(JSON.stringify(new URL(String(input)).host === "api.openfigi.com" ? figi : firds));
}) as typeof globalThis.fetch;

let ctx: Ctx;
let todayOn: string;
let instrumentId: string;
let listingId: string;

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
  const [hit] = (await searchInstruments(ISIN, { fetch: REGISTERS, priceSourceId: "prices" })).items;
  instrumentId = hit.instrumentId;
  listingId = hit.listings[0].listingId;
});

afterAll(closeDatabase);

/** The market closes at `close` today. */
async function closeToday(close: string) {
  await refreshPrices({
    source: {
      id: "prices",
      closes: async (request) => ({
        bars: request.listings.map((one) => ({ key: one.key, on: todayOn, close, currency: "EUR" })),
        errors: [],
      }),
    },
    markets: [{ listingId, neededFrom: todayOn }],
    today: todayOn,
    cap: 10,
  });
}

/** A weekly plan due today: its day is today's weekday. */
const dueToday = (over: Record<string, unknown> = {}) => ({
  name: "Weekly ETF",
  instrument: { instrumentId, mic: "XMIL" },
  amountCents: 100_00n,
  frequency: "week" as const,
  day: dayOfWeek(todayOn) === 0 ? 7 : dayOfWeek(todayOn),
  startOn: todayOn,
  feeCents: 1_00n,
  ...over,
});

async function portfolio(cents = 0n): Promise<string> {
  const { accountId } = await createPortfolioWithAccount(ctx, { name: "Broker", currency: "EUR", url: null });
  if (cents > 0n) await recordOperation(ctx, accountId, { kind: "deposit", on: todayOn, amountCents: cents });
  return accountId;
}

const runsOfDay = () =>
  getDb().select().from(investmentPlanRuns).where(eq(investmentPlanRuns.dueOn, todayOn));

describe("a purchase plan", () => {
  it("proposes its instalment once, however often the job runs, and writes it on confirmation", async () => {
    const accountId = await portfolio(1_000_00n);
    const { id: planId } = await createPlan(ctx, accountId, dueToday());
    await runDuePlans(ctx);
    expect(await runsOfDay()).toMatchObject([{ state: "waiting_price" }]);
    await closeToday("40");
    await runDuePlans(ctx);
    await runDuePlans(ctx);
    expect(await runsOfDay()).toHaveLength(1);
    const [run] = await listRuns(ctx, accountId, planId);
    expect(run).toMatchObject({
      run: { state: "proposed" },
      proposal: { quantity: qty("2.5"), spentCents: 100_00n, feeCents: 1_00n },
    });
    expect((await plansToDo(ctx)).toConfirm).toEqual([
      { runId: run.run.id, accountId, dueOn: todayOn, reason: null },
    ]);
    const { eventId } = await confirmRun(ctx, { accountId, planId, runId: run.run.id }, {});
    await expect(confirmRun(ctx, { accountId, planId, runId: run.run.id }, {})).rejects.toMatchObject({
      code: "not_editable",
    });
    const legs = await getDb()
      .select()
      .from(investmentOperations)
      .where(eq(investmentOperations.eventId, eventId));
    expect(legs.find((leg) => leg.leg === "main")).toMatchObject({ kind: "buy", planRunId: run.run.id });
    // Never a deposit (P1 B): 1,000 in, 100 of the ETF and 1 of fee out.
    const deposits = await getDb()
      .select()
      .from(investmentOperations)
      .where(and(eq(investmentOperations.kind, "deposit")));
    expect(deposits).toHaveLength(1);
    expect((await readingsAt(ctx, [accountId], todayOn)).get(accountId)).toBe(999_00n);
    expect((await listPlans(ctx, accountId))[0]).toMatchObject({ toConfirm: 0, waitingPrice: 0 });
  });

  it("writes an `auto` instalment by itself, and proposes it with its reason when the cash is short (P2)", async () => {
    await closeToday("40");
    const poor = await portfolio();
    const { id: poorPlan } = await createPlan(ctx, poor, dueToday({ mode: "auto" }));
    const rich = await portfolio(1_000_00n);
    await createPlan(ctx, rich, dueToday({ mode: "auto" }));
    await runDuePlans(ctx);
    const [short] = await listRuns(ctx, poor, poorPlan);
    expect(short.run).toMatchObject({ state: "proposed", reason: "negative_cash" });
    const recorded = (await runsOfDay()).find((run) => run.state === "recorded");
    expect(recorded).toMatchObject({ recordedBy: "job" });
    // The refused purchase left nothing behind.
    expect((await readingsAt(ctx, [poor], todayOn)).get(poor) ?? 0n).toBe(0n);
    expect((await readingsAt(ctx, [rich], todayOn)).get(rich)).toBe(999_00n);
  });

  it("buys what the same purchase by hand buys, at the same P&L", async () => {
    await closeToday("40");
    const byPlan = await portfolio(1_000_00n);
    await createPlan(ctx, byPlan, dueToday({ mode: "auto" }));
    await runDuePlans(ctx);
    const byHand = await portfolio(1_000_00n);
    await addAsset(ctx, byHand, {
      asset: { instrument: { instrumentId, mic: "XMIL" } },
      on: todayOn,
      quantity: qty("2.5"),
      unitPrice: price("40"),
      feeCents: 1_00n,
    });
    const values = await readingsAt(ctx, [byPlan, byHand], todayOn);
    expect(values.get(byPlan)).toBe(values.get(byHand));
  });

  it("skips an instalment, records past ones, and is refused on a service that is not a portfolio", async () => {
    await closeToday("40");
    const accountId = await portfolio(1_000_00n);
    const { id: planId } = await createPlan(ctx, accountId, dueToday());
    await runDuePlans(ctx);
    const [run] = await listRuns(ctx, accountId, planId);
    await skipRun(ctx, { accountId, planId, runId: run.run.id });
    await expect(
      backfillPlan(
        ctx,
        { accountId, planId },
        { runs: [{ dueOn: todayOn, on: todayOn, quantity: qty("1"), unitPrice: price("40") }] },
      ),
    ).rejects.toMatchObject({ code: "not_editable" });
    const other = await portfolio(1_000_00n);
    const { id: otherPlan } = await createPlan(ctx, other, dueToday());
    const { eventIds } = await backfillPlan(
      ctx,
      { accountId: other, planId: otherPlan },
      { runs: [{ dueOn: todayOn, on: todayOn, quantity: qty("1"), unitPrice: price("40") }] },
    );
    expect(eventIds).toHaveLength(1);
    const { accountId: manual } = await manualService(ctx, {
      name: "Bank",
      category: "broker",
      currency: "EUR",
    });
    await expect(createPlan(ctx, manual, dueToday())).rejects.toMatchObject({ code: "not_eligible" });
    expect(await listPlans(ctx, manual)).toEqual([]);
    await updatePlan(ctx, accountId, planId, { state: "paused" });
    expect((await listPlans(ctx, accountId))[0]).toMatchObject({
      plan: { state: "paused" },
      nextDueOn: null,
    });
    const linked = await getDb()
      .select()
      .from(investmentEvents)
      .where(eq(investmentEvents.transactionId, investmentEvents.transactionId));
    expect(linked).toHaveLength(0);
  });

  it("proposes the bank movement of its debit account, and links it only on the person's word (E7)", async () => {
    await closeToday("40");
    const bank = await createAccount(ctx, {
      name: "Conto",
      type: "checking",
      currency: "EUR",
      openingBalance: null,
    });
    await accountMovement(ctx, bank.id, todayOn, -101_00n, { payee: "BROKER PAC" });
    const accountId = await portfolio(1_000_00n);
    const { id: planId } = await createPlan(ctx, accountId, dueToday({ debitAccountId: bank.id }));
    await runDuePlans(ctx);
    const [proposed] = await listRuns(ctx, accountId, planId);
    expect(proposed.debit).toMatchObject({ cents: 101_00n, payee: "BROKER PAC", linked: false });
    const { eventId } = await confirmRun(ctx, { accountId, planId, runId: proposed.run.id }, {});
    const [event] = await getDb().select().from(investmentEvents).where(eq(investmentEvents.id, eventId));
    expect(event.transactionId).toBeNull();
    await linkRunDebit(ctx, accountId, planId, proposed.run.id);
    const [linked] = await getDb().select().from(investmentEvents).where(eq(investmentEvents.id, eventId));
    expect(linked.transactionId).toBe(proposed.debit?.transactionId);
    await expect(linkRunDebit(ctx, accountId, planId, proposed.run.id)).rejects.toMatchObject({
      code: "not_editable",
    });
  });

  /**
   * A daily plan made a week ago with a debit account, and `count` bank movements today of one
   * instalment each: the executions whose window (due date to 5 days after) holds today, oldest first,
   * and the movement each was proposed (PERS-729).
   */
  async function debitsOfDailyPlan(count: number) {
    await closeToday("40");
    const bank = await createAccount(ctx, {
      name: "Conto",
      type: "checking",
      currency: "EUR",
      openingBalance: null,
    });
    for (let one = 0; one < count; one += 1) await accountMovement(ctx, bank.id, todayOn, -101_00n);
    const accountId = await portfolio(1_000_00n);
    const weekAgo = addDays(todayOn, -7);
    const { id: planId } = await createPlan(
      ctx,
      accountId,
      dueToday({ frequency: "day", startOn: weekAgo, debitAccountId: bank.id }),
    );
    await getDb().update(investmentPlans).set({ createdOn: weekAgo }).where(eq(investmentPlans.id, planId));
    await runDuePlans(ctx);
    const runs = await getDb().select().from(investmentPlanRuns).where(eq(investmentPlanRuns.planId, planId));
    const eligible = runs
      .filter((run) => run.dueOn >= addDays(todayOn, -5))
      .sort((left, right) => left.dueOn.localeCompare(right.dueOn));
    return { accountId, planId, eligible };
  }

  const debitsOf = (runs: { dueOn: string; state: string; debitTransactionId: string | null }[]) =>
    runs.map((run) => ({ dueOn: run.dueOn, state: run.state, debit: run.debitTransactionId }));

  it("proposes one movement to one execution only, the oldest of those it may document (PERS-729)", async () => {
    const [oldest, ...others] = debitsOf((await debitsOfDailyPlan(1)).eligible);
    expect(others.length).toBeGreaterThan(0);
    expect(oldest).toMatchObject({ state: "proposed", debit: expect.any(String) });
    expect(others.map((run) => run.debit)).toEqual(others.map(() => null));
  });

  it("proposes two movements of one amount to two executions, a different one each (PERS-729)", async () => {
    const runs = debitsOf((await debitsOfDailyPlan(2)).eligible);
    const [first, second, ...others] = runs.map((run) => run.debit);
    expect(first).toEqual(expect.any(String));
    expect(second).toEqual(expect.any(String));
    expect(second).not.toBe(first);
    expect(others).toEqual(others.map(() => null));
  });

  it("gives the movement of a skipped execution to the next one (PERS-729)", async () => {
    const { accountId, planId, eligible } = await debitsOfDailyPlan(1);
    const [oldest, next] = eligible;
    expect(oldest.debitTransactionId).toEqual(expect.any(String));
    await skipRun(ctx, { accountId, planId, runId: oldest.id });
    await runDuePlans(ctx);
    const [after] = await getDb().select().from(investmentPlanRuns).where(eq(investmentPlanRuns.id, next.id));
    expect(after.debitTransactionId).toBe(oldest.debitTransactionId);
  });

  it("takes the payee of a linked debit out of the subscription suggestions (§11.3.3)", async () => {
    await closeToday("40");
    const bank = await createAccount(ctx, {
      name: "Conto",
      type: "checking",
      currency: "EUR",
      openingBalance: null,
    });
    for (const days of [90, 60, 30, 0]) {
      await accountMovement(ctx, bank.id, addDays(todayOn, -days), -101_00n, { payee: "BROKER PAC" });
    }
    await refreshRecurrences(ctx);
    expect((await suggestions(ctx)).map((one) => one.name)).toEqual(["BROKER PAC"]);
    const accountId = await portfolio(1_000_00n);
    const { id: planId } = await createPlan(ctx, accountId, dueToday({ debitAccountId: bank.id }));
    await runDuePlans(ctx);
    const [run] = await listRuns(ctx, accountId, planId);
    await confirmRun(ctx, { accountId, planId, runId: run.run.id }, {});
    await linkRunDebit(ctx, accountId, planId, run.run.id);
    expect(await suggestions(ctx)).toEqual([]);
  });

  it("records the past instalments of a plan older than its portfolio, priced at their closes (P4)", async () => {
    const days = [-21, -14, -7].map((shift) => addDays(todayOn, shift));
    await refreshPrices({
      source: {
        id: "prices",
        closes: async (request) => ({
          bars: request.listings.flatMap((one) =>
            days.map((on) => ({ key: one.key, on, close: "40", currency: "EUR" })),
          ),
          errors: [],
        }),
      },
      markets: [{ listingId, neededFrom: days[0] }],
      today: todayOn,
      cap: 10,
    });
    const accountId = await portfolio();
    const weekday = dayOfWeek(days[0]) === 0 ? 7 : dayOfWeek(days[0]);
    const { id: planId } = await createPlan(ctx, accountId, dueToday({ startOn: days[0], day: weekday }));
    const past = await listPastRuns(ctx, accountId, planId);
    expect(past).toMatchObject({ currency: "EUR", more: false });
    expect(past.runs.map((run) => run.dueOn)).toEqual(days);
    expect(past.runs[0].proposal).toMatchObject({
      quantity: qty("2.5"),
      spentCents: 100_00n,
      feeCents: 1_00n,
    });
    // The deposit that paid them, before the portfolio was made, moves its start back (all or nothing).
    await recordOperation(ctx, accountId, { kind: "deposit", on: days[0], amountCents: 1_000_00n });
    const { eventIds } = await backfillPlan(
      ctx,
      { accountId, planId },
      {
        runs: past.runs.map((run) => ({
          dueOn: run.dueOn,
          on: run.proposal!.on,
          quantity: run.proposal!.quantity,
          unitPrice: run.proposal!.unitPrice,
        })),
      },
    );
    expect(eventIds).toHaveLength(3);
    expect((await listPastRuns(ctx, accountId, planId)).runs).toEqual([]);
    // 1,000 in, 303 out; 7.5 units at 40.
    expect((await readingsAt(ctx, [accountId], days[2])).get(accountId)).toBe(997_00n);
  });

  it("refuses the past of a portfolio that was a value before (before_positions)", async () => {
    await closeToday("40");
    const { accountId } = await manualService(ctx, { name: "Bank", category: "broker", currency: "EUR" });
    await convertToPortfolio(ctx, accountId, { on: todayOn, positions: [] });
    const startOn = addDays(todayOn, -7);
    const { id: planId } = await createPlan(ctx, accountId, dueToday({ startOn }));
    await expect(
      backfillPlan(
        ctx,
        { accountId, planId },
        { runs: [{ dueOn: startOn, on: startOn, quantity: qty("1"), unitPrice: price("40") }] },
      ),
    ).rejects.toMatchObject({ code: "before_positions" });
    await expect(
      recordOperation(ctx, accountId, { kind: "deposit", on: startOn, amountCents: 1_00n }),
    ).rejects.toMatchObject({ code: "before_positions" });
  });
});
