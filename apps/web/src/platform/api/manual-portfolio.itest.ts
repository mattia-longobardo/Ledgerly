// The manual portfolio on /api/v1 (rewrite plan R5d): a portfolio, its cash, a purchase of the
// registry, a sale of more than is held, the price mode, «Switch to positions», the MCP's holdings.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { dayOfWeek, today } from "@domain/shared/dates";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { contextFor } from "../../../../../test/fixtures";
import { createTestUser } from "../../../../../test/users";

let signedIn: Ctx;
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/platform/auth/session", () => ({ requireSession: async () => signedIn }));

const { reads, adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const { refreshPrices, searchInstruments } = await import("@ledgerly/domain/instruments");
const { createAccount } = await import("@domain/modules/accounts/service");
const { runDuePlans } = await import("@ledgerly/domain/investments");

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
  return { status: response.status, body: text === "" ? null : (JSON.parse(text) as Json) };
}

// A public example ISIN (ISO 6166); the registers are fakes, the registry the instance's.
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

let alice: Ctx;
let todayOn: string;
let instrumentId: string;

beforeEach(async () => {
  await resetDatabase();
  alice = contextFor((await createTestUser()).id);
  signedIn = alice;
  todayOn = today(alice.timeZone);
  instrumentId = (await searchInstruments(ISIN, { fetch: REGISTERS, priceSourceId: null })).items[0]
    .instrumentId;
});
afterAll(closeDatabase);

async function portfolio(): Promise<string> {
  const made = await send(alice, "POST", "/investments", {
    kind: "portfolio",
    name: "Broker",
    currency: "EUR",
  });
  expect(made.status).toBe(201);
  return made.body.accountId;
}

const buy = (quantity: string, unitPrice: string) => ({
  kind: "buy",
  instrumentId,
  mic: "XMIL",
  on: todayOn,
  quantity,
  unitPrice,
  fee: "2.00",
});

describe("a manual portfolio on /api/v1", () => {
  it("keeps cash and positions, and never sells more than it holds", async () => {
    const accountId = await portfolio();
    const ops = `/investments/${accountId}/operations`;
    // No money yet: a purchase is refused, and the client offers a deposit (D2).
    expect(await send(alice, "POST", ops, buy("10", "100"))).toMatchObject({
      status: 409,
      body: { error: "conflict", reason: "negative_cash" },
    });
    expect((await send(alice, "POST", ops, { kind: "deposit", on: todayOn, amount: "1500.00" })).status).toBe(
      201,
    );
    expect((await send(alice, "POST", ops, buy("10", "100"))).status).toBe(201);
    const holdings = await send(alice, "GET", `/investments/${accountId}/holdings`);
    expect(holdings.body.cash).toBe("498.00");
    expect(holdings.body.holdings).toHaveLength(1);
    expect(holdings.body.holdings[0].asset).toMatchObject({
      isin: ISIN,
      instrumentId,
      mic: "XMIL",
      price: { mode: "manual", stale: false },
    });
    const tool = reads.find((one) => one.name === "get_investment_holdings")!;
    expect(await tool.run(alice, { account_id: accountId })).toEqual(holdings.body);
    const listed = await send(alice, "GET", "/investments?period=all");
    expect(listed.body.services.find((one: Json) => one.accountId === accountId)).toMatchObject({
      kind: "manual_portfolio",
      value: "1498.00",
    });

    // A fee of its own, from the cash: 498 → 496.
    const fee = await send(alice, "POST", ops, {
      kind: "fee",
      on: todayOn,
      amount: "2.00",
      note: "Stamp duty",
    });
    expect(fee.status).toBe(201);
    expect((await send(alice, "GET", `/investments/${accountId}/holdings`)).body.cash).toBe("496.00");
    const holdingId = await holdingIdOf(accountId);
    const short = await send(alice, "POST", ops, {
      kind: "sell",
      holdingId,
      on: todayOn,
      quantity: "11",
      unitPrice: "100",
    });
    expect(short).toMatchObject({ status: 409, body: { error: "conflict", reason: "quantity_exceeded" } });
    const auto = await send(alice, "PUT", `/investments/${accountId}/holdings/${holdingId}/price-mode`, {
      mode: "auto",
    });
    expect(auto).toMatchObject({ status: 409, body: { error: "conflict", reason: "not_editable" } });
  });

  it("refuses the money in and out and a purchase on a service that is not a portfolio", async () => {
    const made = await send(alice, "POST", "/investments", {
      name: "Bank",
      category: "broker",
      currency: "EUR",
      value: "100.00",
    });
    const ops = `/investments/${made.body.accountId}/operations`;
    expect(await send(alice, "POST", ops, { kind: "deposit", on: todayOn, amount: "1.00" })).toMatchObject({
      status: 409,
      body: { error: "conflict", reason: "not_editable" },
    });
    expect((await send(alice, "POST", ops, buy("1", "1"))).status).toBe(409);
    expect(
      (await send(alice, "POST", ops, { kind: "fee", on: todayOn, amount: "1.00", note: null })).status,
    ).toBe(409);
    const holdings = await send(alice, "GET", `/investments/${made.body.accountId}/holdings`);
    expect(holdings.body.cash).toBeNull();
    const detail = await send(alice, "GET", `/investments/${made.body.accountId}?period=all`);
    expect(detail.body.service.portfolio).toBe(false);
    // The home tells a manual portfolio from a service kept by value alone (PERS-591).
    const portfolioId = await portfolio();
    const home = await send(alice, "GET", "/investments/home?period=all");
    const rows = home.body.groups.flatMap((group: Json) => group.rows);
    expect(rows.find((row: Json) => row.accountId === made.body.accountId)).toMatchObject({
      kind: "manual_portfolio",
      valueOnly: true,
    });
    expect(rows.find((row: Json) => row.accountId === portfolioId)).toMatchObject({
      kind: "manual_portfolio",
      valueOnly: false,
    });
  });

  it("switches a service kept by value to positions, its value unchanged", async () => {
    const account = await createAccount(alice, {
      name: "Titles",
      type: "investment",
      currency: "EUR",
      openingBalance: { on: "2026-01-01", cents: 3_000_00n },
    });
    expect(
      (await send(alice, "POST", "/investments", { accountId: account.id, category: "broker" })).status,
    ).toBe(201);
    const position = { instrumentId, mic: "XMIL", quantity: "10", unitPrice: "100", fxRate: null };
    const switched = await send(alice, "POST", `/investments/${account.id}/conversion`, {
      on: todayOn,
      positions: [position],
      note: null,
    });
    expect(switched.status).toBe(204);
    const holdings = await send(alice, "GET", `/investments/${account.id}/holdings`);
    expect(holdings.body.cash).toBe("2000.00");
    expect(holdings.body.holdings[0].value).toBe("1000.00");
    const again = await send(alice, "POST", `/investments/${account.id}/conversion`, {
      on: todayOn,
      positions: [],
      note: null,
    });
    expect(again).toMatchObject({ status: 409, body: { error: "conflict", reason: "not_eligible" } });
  });

  it("takes an empty address as none, and a bare host as https (PERS-591)", async () => {
    const empty = await send(alice, "POST", "/investments", {
      kind: "portfolio",
      name: "Broker",
      currency: "EUR",
      url: "",
    });
    expect(empty.status).toBe(201);
    const bare = await send(alice, "POST", "/investments", {
      kind: "portfolio",
      name: "Other",
      currency: "EUR",
      url: "broker.example.com",
    });
    expect(bare.status).toBe(201);
    const [one, two] = await Promise.all([
      send(alice, "GET", `/investments/${empty.body.accountId}?period=all`),
      send(alice, "GET", `/investments/${bare.body.accountId}?period=all`),
    ]);
    expect(one.body.service.url).toBeNull();
    expect(one.body.service.portfolio).toBe(true);
    expect(two.body.service.url).toBe("https://broker.example.com");
  });

  it("finds an instrument of the registry by ISIN, with its markets", async () => {
    const found = await send(alice, "GET", `/instruments/search?q=${ISIN}`);
    expect(found).toMatchObject({
      status: 200,
      body: {
        complete: true,
        items: [
          {
            instrumentId,
            isin: ISIN,
            name: "Example ETF",
            class: "etf",
            listings: [{ mic: "XMIL", ticker: "EXA", priced: false }],
          },
        ],
      },
    });
  });
});

async function holdingIdOf(accountId: string): Promise<string> {
  const positions = await send(alice, "GET", `/investments/${accountId}/positions?period=all`);
  return positions.body.open.rows[0].holdingId;
}

describe("the purchase plans on /api/v1 (R5d, step 2)", () => {
  /** A weekly plan due today, proposed for confirmation. */
  const plan = (over: Record<string, unknown> = {}) => ({
    name: "Weekly ETF",
    instrumentId,
    mic: "XMIL",
    amount: "100.00",
    frequency: "week",
    day: dayOfWeek(todayOn) === 0 ? 7 : dayOfWeek(todayOn),
    startOn: todayOn,
    fee: { amount: "1.00" },
    ...over,
  });

  it("lists a plan as the MCP tool does, and writes its instalment when the person confirms it", async () => {
    const accountId = await portfolio();
    const base = `/investments/${accountId}/plans`;
    await send(alice, "POST", `/investments/${accountId}/operations`, {
      kind: "deposit",
      on: todayOn,
      amount: "1000.00",
    });
    expect(await send(alice, "POST", base, plan({ quantity: "1" }))).toMatchObject({ status: 400 });
    const made = await send(alice, "POST", base, plan());
    expect(made.status).toBe(201);
    const listed = await send(alice, "GET", base);
    expect(listed.body.plans).toMatchObject([
      { id: made.body.id, amount: "100.00", fee: { amount: "1.00", rate: null }, nextDueOn: todayOn },
    ]);
    const tool = reads.find((one) => one.name === "list_investment_plans")!;
    expect(await tool.run(alice, { account_id: accountId })).toEqual(listed.body);

    // No prices plugin: the instalment waits for a price, and the person types it.
    await runDuePlans(alice);
    const runs = await send(alice, "GET", `${base}/${made.body.id}/runs`);
    expect(runs.body.runs).toMatchObject([{ state: "waiting_price", proposal: null, automatic: false }]);
    const confirm = `${base}/${made.body.id}/runs/${runs.body.runs[0].id}/confirm`;
    const bought = await send(alice, "POST", confirm, { unitPrice: "40", quantity: "2.5" });
    expect(bought.status).toBe(201);
    expect(await send(alice, "POST", confirm, {})).toMatchObject({
      status: 409,
      body: { reason: "not_editable" },
    });
    const activity = await send(alice, "GET", `/investments/${accountId}/activity?period=all`);
    expect(activity.body.rows.find((row: Json) => row.id === bought.body.id)).toMatchObject({
      leg: { kind: "buy", quantity: "2.500000000000000000" },
      plan: { planId: made.body.id, name: "Weekly ETF", automatic: false },
    });
    expect((await send(alice, "GET", `/investments/${accountId}/holdings`)).body.cash).toBe("899.00");

    const paused = await send(alice, "PATCH", `${base}/${made.body.id}`, { state: "paused" });
    expect(paused.status).toBe(204);
    expect((await send(alice, "GET", base)).body.plans[0]).toMatchObject({
      state: "paused",
      nextDueOn: null,
    });
  });

  it("asks «Da fare» for a deposit when an `auto` instalment finds no cash (P2)", async () => {
    // Another public example ISIN, on the instance's source of prices: its market closes at 40 today.
    const registers = (async (input: string | URL | Request) => {
      const answer = await REGISTERS(input);
      return new Response((await answer.text()).replace("BBG000000001", "BBG000000002"));
    }) as typeof globalThis.fetch;
    const [hit] = (await searchInstruments("US5949181045", { fetch: registers, priceSourceId: "prices" }))
      .items;
    await refreshPrices({
      source: {
        id: "prices",
        closes: async (request) => ({
          bars: request.listings.map((one) => ({ key: one.key, on: todayOn, close: "40", currency: "EUR" })),
          errors: [],
        }),
      },
      markets: [{ listingId: hit.listings[0].listingId, neededFrom: todayOn }],
      today: todayOn,
      cap: 10,
    });
    const accountId = await portfolio();
    expect(
      (
        await send(
          alice,
          "POST",
          `/investments/${accountId}/plans`,
          plan({ mode: "auto", instrumentId: hit.instrumentId }),
        )
      ).status,
    ).toBe(201);
    await runDuePlans(alice);
    const todo = await send(alice, "GET", "/todo");
    expect(todo.body.items).toMatchObject([
      {
        event: "plan_run_no_cash",
        params: { date: todayOn },
        target: { page: "investment_plan", id: accountId },
      },
    ]);
  });

  it("is refused on a service that is not a portfolio, and lists none there", async () => {
    const made = await send(alice, "POST", "/investments", {
      name: "Bank",
      category: "broker",
      currency: "EUR",
      value: "100.00",
    });
    const base = `/investments/${made.body.accountId}/plans`;
    expect(await send(alice, "POST", base, plan())).toMatchObject({
      status: 409,
      body: { reason: "not_eligible" },
    });
    expect((await send(alice, "GET", base)).body).toEqual({ accountId: made.body.accountId, plans: [] });
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect((await send(alice, "GET", `/investments/${unknown}/plans`)).status).toBe(404);
  });
});
