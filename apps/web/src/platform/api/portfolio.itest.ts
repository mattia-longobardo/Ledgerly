// The one list of Investments (rewrite plan R5b, gate G5): one total, equal to Overview's
// «Investments»; two subtotals, equal to Overview's two groups; every row summed into its group; the
// answers without `include=funds` as before; `list_funds` = its route = the export's numbers.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { centsToDecimal } from "@domain/shared/money";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { contextFor } from "../../../../../test/fixtures";
import { debitFund } from "../../../../../test/funds";
import { createTestUser } from "../../../../../test/users";

let signedIn: Ctx;
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/platform/auth/session", () => ({ requireSession: async () => signedIn }));
// The funds «to verify» need a year of payslips: the test names them, the rest of the module is real.
const verify = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("@ledgerly/domain/funds", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ledgerly/domain/funds")>()),
  fundsToVerify: async () => verify.ids,
}));

const { reads, adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const funds = await import("@ledgerly/domain/funds");
const { createAccount } = await import("@domain/modules/accounts/service");
const { manualService } = await import("../../../../../test/investments");

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the answers are read as JSON
type Json = any;

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
const sum = (amounts: string[]) =>
  centsToDecimal(amounts.reduce((total, one) => total + BigInt(one.replace(".", "")), 0n));

let alice: Ctx;
let fundId: string;
let directa: string;

beforeEach(async () => {
  await resetDatabase();
  alice = contextFor((await createTestUser()).id);
  signedIn = alice;
  // A manual service, an investment account kept as a total, a pension fund, and a current account.
  directa = (await manualService(alice, { name: "Directa", category: "broker", currency: "EUR" })).accountId;
  expect(
    (await send(alice, "PUT", `/investments/${directa}/value`, { on: "2026-03-31", amount: "1000.00" }))
      .status,
  ).toBe(204);
  await createAccount(alice, {
    name: "Polizza",
    type: "investment",
    currency: "EUR",
    openingBalance: { on: "2026-01-01", cents: 50_00n },
  });
  const fund = await debitFund(alice, {
    name: "Fondo Pensione",
    startOn: "2026-01-01",
    monthlyCents: null,
    initialCents: 500_000n,
  });
  fundId = fund.id;
  await funds.recordValuation(alice, fund.id, { on: "2026-03-31", cents: 530_000n });
  await createAccount(alice, {
    name: "Conto",
    type: "checking",
    currency: "EUR",
    openingBalance: { on: "2026-01-01", cents: 900_00n },
  });
});
afterAll(closeDatabase);

describe("the one list of Investments", () => {
  it("has one total, Overview's «Investments», and two subtotals, Overview's two groups", async () => {
    const [home, overview] = await Promise.all([
      send(alice, "GET", "/investments/home?period=all"),
      send(alice, "GET", "/net-worth?months=1"),
    ]);
    expect(home.status).toBe(200);
    expect(overview.status).toBe(200);
    expect(home.body.total.value).toBe(overview.body.buckets.investments.total);
    expect(home.body.total.value).toBe("6350.00");
    expect(home.body.groups.map((group: Json) => [group.id, group.kpis.value])).toEqual(
      overview.body.investmentGroups.map((group: Json) => [group.id, group.total]),
    );
    expect(overview.body.investmentGroups.map((group: Json) => [group.id, group.total])).toEqual([
      ["stocks_crypto", "1050.00"],
      ["pension_funds", "5300.00"],
    ]);
    // Each subtotal is the sum of its rows.
    for (const group of home.body.groups) {
      const counted = group.rows.filter((row: Json) => row.inTotal).map((row: Json) => row.displayValue);
      expect(sum(counted)).toBe(group.kpis.value);
    }
    expect(
      home.body.groups.flatMap((group: Json) =>
        group.rows.map((row: Json) => [row.kind, row.name, row.fundId]),
      ),
    ).toEqual([
      ["manual_portfolio", "Directa", null],
      ["manual_portfolio", "Polizza", null],
      ["pension_fund", "Fondo Pensione", fundId],
    ]);
    // Overview names the group of each account it counts, and none for the current account.
    const groupOf = new Map(overview.body.accounts.map((row: Json) => [row.name, row.investmentGroup]));
    expect(Object.fromEntries(groupOf)).toMatchObject({
      Directa: "stocks_crypto",
      Polizza: "stocks_crypto",
      "Fondo Pensione": "pension_funds",
      Conto: null,
    });
  });

  it("measures the funds' group with the numbers of Funds", async () => {
    const [home, fundsHome] = await Promise.all([
      send(alice, "GET", "/investments/home?period=all"),
      send(alice, "GET", "/funds?period=all"),
    ]);
    const pension = home.body.groups.find((group: Json) => group.id === "pension_funds");
    expect(pension.kpis).toMatchObject({
      gain: fundsHome.body.summary.gain,
      paidIn: fundsHome.body.summary.paidIn,
      // Investments rounds a ratio to 6 decimals.
      rate: Number(fundsHome.body.summary.rate.toFixed(6)),
    });
  });

  it("answers GET /investments as before without include=funds, and adds the list with it", async () => {
    const before = await send(alice, "GET", "/investments?period=all");
    expect(Object.keys(before.body).sort()).toEqual(["currency", "on", "pnl", "services", "totals"]);
    expect(before.body.services.map((one: Json) => [one.accountId, one.kind])).toEqual([
      [directa, "manual_portfolio"],
    ]);
    expect(await tool("list_investments").run(alice, { period: "all" })).toEqual(before.body);

    const withFunds = await send(alice, "GET", "/investments?period=all&include=funds");
    // The services' group gains what the P&L of the portfolio says.
    const services = withFunds.body.groups.find((group: Json) => group.id === "stocks_crypto");
    expect(services.kpis.gain).toBe(before.body.pnl.pnl ?? null);
    const home = await send(alice, "GET", "/investments/home?period=all");
    expect(withFunds.body.total).toEqual(home.body.total);
    expect(withFunds.body.groups).toEqual(home.body.groups);
    // Everything of before stays as it was.
    expect({ ...withFunds.body, total: undefined, groups: undefined }).toEqual({
      ...before.body,
      total: undefined,
      groups: undefined,
    });
    expect(await tool("list_investments").run(alice, { period: "all", include: "funds" })).toEqual(
      withFunds.body,
    );
  });

  it("lists the funds with no type, as the export has them, through the route and list_funds", async () => {
    const listed = await send(alice, "GET", "/investments/funds");
    expect(listed.status).toBe(200);
    expect(await tool("list_funds").run(alice, {})).toEqual(listed.body);
    const [exported] = await funds.fundsExport(alice);
    expect(listed.body.funds).toEqual([
      {
        id: fundId,
        accountId: exported.fund.valuationAccountId,
        name: "Fondo Pensione",
        provider: null,
        currency: "EUR",
        value: "5300.00",
        displayValue: "5300.00",
        lastValuation: "2026-03-31",
        paidIn: centsToDecimal(exported.paidInCents!),
        gain: centsToDecimal(exported.gainCents!),
        state: "active",
      },
    ]);
    expect(JSON.stringify(listed.body)).not.toMatch(/"pac"|"kind"/);
  });

  it("names the fund of its account in GET /accounts/{id}, and no fund for another account", async () => {
    const [exported] = await funds.fundsExport(alice);
    const fundAccount = await send(alice, "GET", `/accounts/${exported.fund.valuationAccountId}`);
    expect(fundAccount.body.fundId).toBe(fundId);
    expect((await send(alice, "GET", `/accounts/${directa}`)).body.fundId).toBeNull();
  });

  it("links a fund of «Da fare» and of the search to its account in Investments", async () => {
    const [exported] = await funds.fundsExport(alice);
    const accountId = exported.fund.valuationAccountId;
    verify.ids = [fundId];
    try {
      const todo = await send(alice, "GET", "/todo");
      const item = todo.body.items.find((one: Json) => one.event === "fund_to_verify");
      expect(item.target).toEqual({ page: "fund", id: fundId, pageId: accountId });
      const feed = await send(alice, "GET", "/notifications");
      const notified = feed.body.items.find((one: Json) => one.event === "fund_to_verify");
      expect(notified.target).toEqual({ page: "fund", id: fundId, pageId: accountId });
    } finally {
      verify.ids = [];
    }
    const found = await send(alice, "GET", "/search?q=pensione");
    expect(found.body.records).toEqual([{ kind: "fund", id: fundId, name: "Fondo Pensione", accountId }]);
  });

  it("gives an archived fund the paid-in money and the gain of its page, and no value", async () => {
    await funds.setFundState(alice, fundId, "archived");
    const page = await send(alice, "GET", `/funds/${fundId}?period=all`);
    expect(page.status).toBe(200);
    const listed = await send(alice, "GET", "/investments/funds");
    const [archived] = listed.body.funds;
    expect(archived).toMatchObject({
      state: "archived",
      value: null,
      displayValue: null,
      lastValuation: null,
    });
    expect(archived.gain).not.toBeNull();
    expect({ paidIn: archived.paidIn, gain: archived.gain }).toEqual({
      paidIn: page.body.line.paidIn,
      gain: page.body.line.gain,
    });
    expect(await tool("list_funds").run(alice, {})).toEqual(listed.body);
    // The export keeps its rule: an archived fund has no number there.
    const [exported] = await funds.fundsExport(alice);
    expect(exported).toMatchObject({ paidInCents: null, gainCents: null, valueCents: null });
  });

  it("makes a manual service on a new account from four fields, in its own currency", async () => {
    const made = await send(alice, "POST", "/investments", {
      name: "Interactive",
      category: "broker",
      currency: "USD",
      value: "2500.00",
    });
    expect(made.status).toBe(201);
    const listed = await send(alice, "GET", "/investments?period=all");
    const service = listed.body.services.find((one: Json) => one.accountId === made.body.accountId);
    expect(service).toMatchObject({
      name: "Interactive",
      currency: "USD",
      value: "2500.00",
      kind: "manual_portfolio",
    });
    // The old body still makes a service of an account that exists.
    const refused = await send(alice, "POST", "/investments", {
      accountId: made.body.accountId,
      category: "broker",
    });
    expect(refused.status).toBe(409);
  });

  it("answers nothing of another person", async () => {
    const bob = contextFor((await createTestUser()).id);
    const listed = await send(bob, "GET", "/investments/funds");
    expect(listed.body.funds).toEqual([]);
    const home = await send(bob, "GET", "/investments/home?period=all");
    expect(home.body.groups).toEqual([]);
    expect(home.body.total).toMatchObject({ value: null, gain: null, rateReason: "none" });
  });
});
