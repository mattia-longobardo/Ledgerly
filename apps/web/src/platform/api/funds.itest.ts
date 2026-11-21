// The routes of funds (rewrite plan R2, 05-refactor.md §5.5): each Server Action's use case through
// its route, the person's own data only, and page = route = MCP tool. «Accept the difference» saves
// the same decision from the Server Action and from the route: the numbers are the server's in both.
// The guard is the test's: `api.itest.ts` proves the tokens.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { deleteFolder, ensureBucket } from "@domain/platform/storage";
import { centsToDecimal } from "@domain/shared/money";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { debitFund, payrollFund } from "../../../../../test/funds";
import { createTestUser } from "../../../../../test/users";
import { MARCH } from "../../../../../test/fixtures/payroll/samples";
import { twinPdf } from "../../../../../test/fixtures/payroll/twin";

let signedIn: Ctx;
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/platform/auth/session", () => ({ requireSession: async () => signedIn }));

const { reads, adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const funds = await import("@ledgerly/domain/funds");
const payroll = await import("@ledgerly/domain/payroll");
const { decisionsOf: decisionsByFund } = await import("@domain/modules/funds/pension/service");
const { fundDetail } = await import("@domain/modules/funds/queries");
const { homeSummary, firstDataOn } = await import("@domain/modules/funds/home");
const { fundsHomeRows } = await import("@domain/modules/funds/home-queries");
const { allPeriod } = await import("@domain/modules/funds/period");
const { today } = await import("@domain/shared/dates");

/** The deleted Server Action (R3 of funds), line for line: the use case with the fields it read. */
async function decideDifferenceAction(
  fundId: string,
  input: { year: number; quarter: number; component: string; note: string },
) {
  await funds.acceptDifference(signedIn, fundId, {
    year: input.year,
    quarter: input.quarter,
    component: input.component as never,
    note: input.note,
  });
  return { ok: true };
}

function contextFor(userId: string): Ctx {
  return {
    userId,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
}

async function send(ctx: Ctx, method: string, path: string, body?: unknown) {
  const routes = apiRoutes({
    ...adapters,
    guard: () => async (context, next) => {
      context.set("ctx", ctx);
      await next();
    },
  });
  const response = await routes.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : JSON.parse(text) };
}

const tool = (name: string) => reads.find((one) => one.name === name)!;

const PLAN = {
  name: "Piano",
  provider: "Example",
  compartment: "Balanced",
  code: null,
  debitAccountId: null,
  debitDay: 5,
  ter: null,
  startOn: "2026-01-01",
  monthlyCents: 25_100n,
  depositFeeCents: 100n,
  initialCents: 500_000n,
};

let alice: Ctx;
let bob: Ctx;

beforeAll(ensureBucket);
beforeEach(async () => {
  await resetDatabase();
  alice = contextFor((await createTestUser()).id);
  bob = contextFor((await createTestUser()).id);
  signedIn = alice;
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await deleteFolder("payslips/");
  await closeDatabase();
});

describe("the reads of funds", () => {
  it("answer the numbers the page reads, and get_funds and get_fund the same", async () => {
    const fund = await debitFund(alice, PLAN);
    await funds.recordValuation(alice, fund.id, { on: "2026-03-31", cents: 530_000n });

    const home = await send(alice, "GET", "/funds?period=all");
    expect(home.status).toBe(200);
    expect(await tool("get_funds").run(alice, { period: "all" })).toEqual(home.body);
    // Page = route: the summary the page draws, from the same engine.
    const todayOn = today(alice.timeZone);
    const homes = (await fundsHomeRows(alice)).map((row) => row.home);
    const page = homeSummary({
      funds: homes,
      period: allPeriod(todayOn),
      todayOn,
      firstOn: firstDataOn(homes),
    });
    expect(home.body.summary).toMatchObject({
      gain: centsToDecimal(page.gainCents!),
      paidIn: centsToDecimal(page.paidInCents),
      value: centsToDecimal(page.valueCents!),
    });
    expect(home.body.funds.map((one: { id: string }) => one.id)).toEqual([fund.id]);

    const overview = await send(alice, "GET", `/funds/${fund.id}?period=all`);
    expect(overview.status).toBe(200);
    expect(await tool("get_fund").run(alice, { id: fund.id, period: "all" })).toEqual(overview.body);
    expect(overview.body.line.gain).toBe(home.body.funds[0].line.gain);

    for (const tab of ["valuations?period=all", "contributions?period=all", "settings"]) {
      expect((await send(alice, "GET", `/funds/${fund.id}/${tab}`)).status).toBe(200);
    }
    const valuations = await send(alice, "GET", `/funds/${fund.id}/valuations?period=all`);
    expect(valuations.body.recorded.map((one: { on: string }) => one.on)).toEqual(["2026-03-31"]);

    // Somebody else's fund does not exist, and their home is empty.
    expect((await send(bob, "GET", `/funds/${fund.id}`)).status).toBe(404);
    expect((await send(bob, "GET", "/funds")).body.funds).toEqual([]);
    // A year to come, or days that are not a period, are refused.
    expect((await send(alice, "GET", "/funds?period=2999")).status).toBe(400);
    expect((await send(alice, "GET", "/funds?period=custom&from=2026-05-01")).status).toBe(400);
  });
});

describe("the writes of funds", () => {
  it("create, change, value, register, configure and archive a fund through the routes", async () => {
    const created = await send(alice, "POST", "/funds", {
      fund: { name: "Nuovo", provider: null, compartment: null, startOn: "2026-01-01", code: null },
      currency: null,
      value: { on: "2026-02-28", value: "1000.00" },
      sources: [{ kind: "manual" }],
      fees: [{ label: "Entry", basis: "one_off", amount: "10.00", source: 0 }],
    });
    expect(created).toMatchObject({ status: 201, body: { published: 0 } });
    const id = created.body.id;
    expect(
      await send(alice, "POST", "/funds", {
        fund: { name: "Nuovo", startOn: "2026-01-01" },
        sources: [],
        fees: [],
      }),
    ).toEqual({ status: 409, body: { error: "conflict", reason: "duplicate_name" } });

    expect(
      (await send(alice, "PATCH", `/funds/${id}`, { name: "Rinominato", startOn: "2026-01-01" })).status,
    ).toBe(204);

    const valued = await send(alice, "POST", `/funds/${id}/valuations`, {
      on: "2026-03-31",
      value: "1100.00",
    });
    expect(valued.status).toBe(201);
    expect(await send(alice, "POST", `/funds/${id}/valuations`, { on: "2999-01-01", value: "1.00" })).toEqual(
      { status: 400, body: { error: "invalid", reason: "future_date" } },
    );
    expect(
      (
        await send(alice, "PATCH", `/funds/${id}/valuations/${valued.body.id}`, {
          on: "2026-03-31",
          value: "1150.00",
        })
      ).status,
    ).toBe(204);

    const paid = await send(alice, "POST", `/funds/${id}/operations`, {
      kind: "voluntary",
      on: "2026-03-10",
      amount: "100.00",
      fee: null,
    });
    expect(paid.status).toBe(201);
    expect(
      (
        await send(alice, "PATCH", `/funds/${id}/operations/${paid.body.id}`, {
          kind: "voluntary",
          on: "2026-03-10",
          amount: "120.00",
          fee: "1.00",
        })
      ).status,
    ).toBe(204);
    const register = await send(alice, "GET", `/funds/${id}/contributions?period=2026`);
    expect(register.body.operations).toMatchObject([{ id: paid.body.id, worker: "120.00", fee: "1.00" }]);
    expect((await send(alice, "DELETE", `/funds/${id}/operations/${paid.body.id}`)).status).toBe(204);
    expect((await send(alice, "DELETE", `/funds/${id}/valuations/${valued.body.id}`)).status).toBe(204);

    const fee = await send(alice, "POST", `/funds/${id}/fees`, {
      label: "Assets",
      basis: "on_assets",
      rate: "0.45",
      period: "year",
    });
    expect(fee.status).toBe(201);
    let settings = await send(alice, "GET", `/funds/${id}/settings`);
    expect(settings.body.fees.find((one: { id: string }) => one.id === fee.body.id)).toMatchObject({
      rate: "0.45",
      period: "year",
    });
    expect(
      (
        await send(alice, "PATCH", `/funds/${id}/fees/${fee.body.id}`, {
          label: "Assets",
          basis: "on_assets",
          rate: "0.5",
          period: "year",
        })
      ).status,
    ).toBe(204);
    expect((await send(alice, "DELETE", `/funds/${id}/fees/${fee.body.id}`)).status).toBe(204);

    const debit = await send(alice, "POST", `/funds/${id}/sources`, {
      kind: "bank_debit",
      amount: "50.00",
      frequency: { count: 1, unit: "month" },
      payeeMatch: "EXAMPLE FUND",
    });
    expect(debit).toMatchObject({ status: 201, body: { published: 0 } });
    expect(
      (await send(alice, "PUT", `/funds/${id}/sources/${debit.body.id}/state`, { state: "paused" })).status,
    ).toBe(204);
    const removed = await send(alice, "DELETE", `/funds/${id}/sources/${debit.body.id}`);
    expect(removed).toMatchObject({ status: 200, body: { source: { id: debit.body.id, amount: "50.00" } } });
    expect((await send(alice, "POST", `/funds/${id}/sources/restore`, removed.body)).status).toBe(204);
    settings = await send(alice, "GET", `/funds/${id}/settings`);
    expect(settings.body.sources.find((one: { id: string }) => one.id === debit.body.id)).toMatchObject({
      state: "paused",
      amount: "50.00",
      payeeMatch: "EXAMPLE FUND",
    });

    // Nothing of alice's is bob's to change.
    expect((await send(bob, "PATCH", `/funds/${id}`, { name: "X", startOn: "2026-01-01" })).status).toBe(404);
    expect((await send(alice, "PUT", `/funds/${id}/state`, { state: "archived" })).status).toBe(204);
    expect((await send(alice, "GET", `/funds/${id}/settings`)).body.fund.state).toBe("archived");
  });
});

describe("«Accept the difference»", () => {
  /** The payslip twins are of 2031: the clock stops there, so their quarter is past its deadline. */
  const NOW = new Date("2031-10-15T10:00:00Z");

  /** A fund fed by the payslip of March, credited one cent more than the payslip accrued for the worker. */
  async function discrepancy(ctx: Ctx) {
    const stop = () => {
      // Only `Date` is faked: the pool's own timers must keep running.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
    };
    stop();
    const fund = await payrollFund(ctx, { name: "Cometa", startOn: "2031-01-01" });
    // S3 refuses a request signed years from now: the payslip is read with the real clock.
    vi.useRealTimers();
    const { document } = await payroll.uploadPayslip(ctx, { name: "march.pdf", bytes: await twinPdf(MARCH) });
    await payroll.processPayslip(ctx, document.id);
    await payroll.verifyPayslip(ctx, document.id);
    await payroll.applyPayslip(ctx, document.id);
    stop();
    const quarter = (await fundDetail(ctx, fund.id)).quarters.find(
      (one) => one.year === 2031 && one.quarter === 1,
    )!;
    const accrued = (component: string) =>
      quarter.components.find((one) => one.component === component)!.accruedCents ?? 0n;
    await funds.addContribution(ctx, fund.id, {
      kind: "payroll",
      on: "2031-04-18",
      workerCents: accrued("worker") + 1n,
      employerCents: accrued("employer"),
      tfrCents: accrued("tfr"),
      period: { year: 2031, index: 1 },
      feeCents: 0n,
    });
    return fund;
  }

  const saved = async (ctx: Ctx, fundId: string) =>
    (await decisionsByFund(ctx, [fundId]))
      .get(fundId)!
      .map(
        ({
          year,
          quarter,
          component,
          decision,
          note,
          differenceCents,
          accruedCents,
          creditedCents,
          competenceIds,
          operationIds,
        }) => ({
          year,
          quarter,
          component,
          decision,
          note,
          differenceCents,
          accruedCents,
          creditedCents,
          competenceIds,
          operationIds,
        }),
      );

  it("saves the same decision from the Server Action and from the route", async () => {
    const fund = await discrepancy(alice);
    const before = (await fundDetail(alice, fund.id)).quarters.find(
      (one) => one.year === 2031 && one.quarter === 1,
    )!;
    expect(before.components.find((one) => one.component === "worker")!.differenceCents).toBe(1n);

    // The action, with numbers the browser could have changed: the server's are saved.
    expect(
      await decideDifferenceAction(fund.id, {
        year: 2031,
        quarter: 1,
        component: "worker",
        note: "Rounded by the fund",
        differenceCents: "99.00",
      } as never),
    ).toMatchObject({ ok: true });
    const fromAction = await saved(alice, fund.id);
    expect(fromAction).toMatchObject([{ differenceCents: 1n, note: "Rounded by the fund" }]);

    expect((await send(alice, "DELETE", `/funds/${fund.id}/periods/2031/1/worker/decision`)).status).toBe(
      204,
    );
    expect(await saved(alice, fund.id)).toEqual([]);
    expect(
      (
        await send(alice, "PUT", `/funds/${fund.id}/periods/2031/1/worker/decision`, {
          note: "Rounded by the fund",
        })
      ).status,
    ).toBe(204);
    expect(await saved(alice, fund.id)).toEqual(fromAction);

    const register = await send(alice, "GET", `/funds/${fund.id}/contributions?period=2031`);
    const period = register.body.payroll.periods.find((one: { index: number }) => one.index === 1);
    expect(
      period.components.find((one: { component: string }) => one.component === "worker").decision,
    ).toEqual({
      note: "Rounded by the fund",
      difference: "0.01",
    });
    // Another person's fund is not a period to decide on.
    expect(
      (await send(bob, "PUT", `/funds/${fund.id}/periods/2031/1/worker/decision`, { note: "x" })).status,
    ).toBe(404);
  });
});
