// The manual portfolio on /api/v1 (rewrite plan R5d): a portfolio, its cash, a purchase of the
// registry, a sale of more than is held, the price mode, «Switch to positions», the MCP's holdings.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { addDays, dayOfWeek, today } from "@domain/shared/dates";
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
const { pricedMarkets, revalueAfterPrices, runDuePlans } = await import("@ledgerly/domain/investments");

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the answers are read as JSON
type Json = any;

/** The first reads of a market the routes queued (PERS-694); `queueFails`: the queue is down. */
let queuedPrices = 0;
let queueFails = false;

async function send(ctx: Ctx, method: string, path: string, body?: unknown) {
  const routes = apiRoutes({
    ...adapters,
    investments: {
      ...adapters.investments,
      async queuePrices() {
        if (queueFails) throw new Error("queue down");
        queuedPrices += 1;
      },
    },
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
  queuedPrices = 0;
  queueFails = false;
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

  it("edits a purchase and a deposit as new ones, and refuses what a new one is refused (PERS-683)", async () => {
    const accountId = await portfolio();
    const ops = `/investments/${accountId}/operations`;
    const deposit = await send(alice, "POST", ops, { kind: "deposit", on: todayOn, amount: "1500.00" });
    const bought = await send(alice, "POST", ops, buy("10", "100"));
    const cash = async () => (await send(alice, "GET", `/investments/${accountId}/holdings`)).body.cash;
    expect(await cash()).toBe("498.00");

    const edited = { ...buy("8", "110"), fee: "1.00" };
    expect(await send(alice, "PATCH", `${ops}/${bought.body.id}`, edited)).toEqual({
      status: 204,
      body: null,
    });
    // 1,500 − 880 − 1, and the same position a new purchase of 8 at 110 makes.
    expect(await cash()).toBe("619.00");
    const holdings = (await send(alice, "GET", `/investments/${accountId}/holdings`)).body.holdings;
    expect(holdings).toHaveLength(1);
    const listed = await send(alice, "GET", "/investments?period=all");
    expect(listed.body.services.find((one: Json) => one.accountId === accountId).value).toBe("1499.00");

    const patch = (eventId: string, body: unknown) => send(alice, "PATCH", `${ops}/${eventId}`, body);
    expect(await patch(deposit.body.id, { kind: "deposit", on: todayOn, amount: "1000.00" })).toEqual({
      status: 204,
      body: null,
    });
    expect(await cash()).toBe("119.00");
    // Less money than the purchase spends, another kind, a day in the future, a body that is not one.
    expect(await patch(deposit.body.id, { kind: "deposit", on: todayOn, amount: "800.00" })).toMatchObject({
      status: 409,
      body: { reason: "negative_cash" },
    });
    expect(await patch(bought.body.id, { kind: "fee", on: todayOn, amount: "1.00" })).toMatchObject({
      status: 409,
      body: { reason: "not_editable" },
    });
    expect(await patch(bought.body.id, { ...edited, on: "2999-01-01" })).toMatchObject({
      status: 400,
      body: { reason: "future_date" },
    });
    expect((await patch(bought.body.id, { kind: "buy" })).status).toBe(400);
    // Under another portfolio, or another person's: not found.
    const other = await portfolio();
    expect(
      (await send(alice, "PATCH", `/investments/${other}/operations/${bought.body.id}`, edited)).status,
    ).toBe(404);
    const bob = contextFor((await createTestUser()).id);
    expect((await send(bob, "PATCH", `${ops}/${bought.body.id}`, edited)).status).toBe(404);
    expect(await cash()).toBe("119.00");
  });

  it("reads each operation as the body of its edit, and that body sent back changes nothing (PERS-695)", async () => {
    const accountId = await portfolio();
    const bank = await createAccount(alice, { name: "Bank", type: "checking", currency: "EUR" });
    const ops = `/investments/${accountId}/operations`;
    const write = async (body: Json) => {
      const made = await send(alice, "POST", ops, body);
      expect(made.status).toBe(201);
      return made.body.id as string;
    };
    const deposit = await write({
      kind: "deposit",
      on: todayOn,
      amount: "1500.00",
      counterpart: { kind: "account", accountId: bank.id },
      note: "Top up",
    });
    const withdrawal = await write({
      kind: "withdrawal",
      on: todayOn,
      amount: "10.00",
      counterpart: { kind: "none" },
    });
    const bought = await write(buy("10", "100"));
    const holdingId = await holdingIdOf(accountId);
    const others = [
      await write({ kind: "fee", on: todayOn, amount: "1.50" }),
      await write({ kind: "income", holdingId, on: todayOn, amount: "3.00" }),
      await write({ kind: "valuation", holdingId, on: todayOn, unitPrice: "101.5" }),
      await write({ kind: "sell", holdingId, on: todayOn, quantity: "2", unitPrice: "105", fee: "1.00" }),
    ];
    const read = (eventId: string) => send(alice, "GET", `${ops}/${eventId}`);
    expect(await read(deposit)).toEqual({
      status: 200,
      body: {
        kind: "deposit",
        body: {
          kind: "deposit",
          on: todayOn,
          amount: "1500.00",
          transactionId: null,
          counterpart: { kind: "account", accountId: bank.id },
          note: "Top up",
        },
      },
    });
    expect((await read(withdrawal)).body.body.counterpart).toEqual({ kind: "none" });
    expect((await read(bought)).body).toEqual({
      kind: "buy",
      body: {
        kind: "buy",
        instrumentId,
        mic: "XMIL",
        on: todayOn,
        quantity: "10",
        unitPrice: "100",
        amount: null,
        fee: "2.00",
        fxRate: null,
        note: null,
      },
    });
    expect((await read(others[3])).body.body).toMatchObject({ quantity: "2", unitPrice: "105", fee: "1.00" });

    const state = async () => ({
      holdings: (await send(alice, "GET", `/investments/${accountId}/holdings`)).body,
      rows: (await send(alice, "GET", `/investments/${accountId}/activity?period=all`)).body.rows,
      movements: (await send(alice, "GET", "/transactions")).body,
    });
    const before = await state();
    expect(before.rows.every((row: Json) => row.editable)).toBe(true);
    for (const eventId of [deposit, withdrawal, bought, ...others]) {
      const { body } = await read(eventId);
      expect(await send(alice, "PATCH", `${ops}/${eventId}`, body.body)).toEqual({ status: 204, body: null });
      expect((await read(eventId)).body).toEqual(body);
    }
    expect(await state()).toEqual(before);
  });

  it("reads a purchase's fee in the instrument's currency, at the rate typed (PERS-695)", async () => {
    const made = await send(alice, "POST", "/investments", {
      kind: "portfolio",
      name: "Dollars",
      currency: "USD",
    });
    const ops = `/investments/${made.body.accountId}/operations`;
    expect((await send(alice, "POST", ops, { kind: "deposit", on: todayOn, amount: "1000.00" })).status).toBe(
      201,
    );
    const bought = await send(alice, "POST", ops, { ...buy("1", "100"), fxRate: "1.1" });
    const cash = async () =>
      (await send(alice, "GET", `/investments/${made.body.accountId}/holdings`)).body.cash;
    // 1,000 − 110 − 2.20, in dollars.
    expect(await cash()).toBe("887.80");
    const { body } = await send(alice, "GET", `${ops}/${bought.body.id}`);
    expect(body.body).toMatchObject({ quantity: "1", unitPrice: "100", fee: "2.00", fxRate: "1.1" });
    expect((await send(alice, "PATCH", `${ops}/${bought.body.id}`, body.body)).status).toBe(204);
    expect(await cash()).toBe("887.80");
  });

  it("refuses the read where the edit is refused, and another's operation is not found (PERS-695)", async () => {
    const account = await createAccount(alice, {
      name: "Titles",
      type: "investment",
      currency: "EUR",
      openingBalance: { on: "2026-01-01", cents: 3_000_00n },
    });
    await send(alice, "POST", "/investments", { accountId: account.id, category: "broker" });
    const position = { instrumentId, mic: "XMIL", quantity: "10", unitPrice: "100", fxRate: null };
    await send(alice, "POST", `/investments/${account.id}/conversion`, {
      on: todayOn,
      positions: [position],
      note: null,
    });
    // What «Switch to positions» wrote is no operation the person typed.
    const rows = (await send(alice, "GET", `/investments/${account.id}/activity?period=all`)).body.rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row: Json) => !row.editable)).toBe(true);
    expect(await send(alice, "GET", `/investments/${account.id}/operations/${rows[0].id}`)).toMatchObject({
      status: 409,
      body: { error: "conflict", reason: "not_editable" },
    });

    const accountId = await portfolio();
    const deposit = await send(alice, "POST", `/investments/${accountId}/operations`, {
      kind: "deposit",
      on: todayOn,
      amount: "10.00",
    });
    const path = `/investments/${accountId}/operations/${deposit.body.id}`;
    expect((await send(alice, "GET", path)).status).toBe(200);
    expect(
      (await send(alice, "GET", `/investments/${account.id}/operations/${deposit.body.id}`)).status,
    ).toBe(404);
    expect((await send(alice, "GET", `/investments/${accountId}/operations/${rows[0].id}`)).status).toBe(404);
    const bob = contextFor((await createTestUser()).id);
    expect((await send(bob, "GET", path)).status).toBe(404);
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

describe("the purchase plans on /api/v1 (R5d, step 2; baskets since PERS-681)", () => {
  /** A weekly basket of one instrument due today: every execution is a proposal. */
  const plan = (over: Record<string, unknown> = {}) => ({
    name: "Weekly ETF",
    amount: "100.00",
    instruments: [{ instrumentId, mic: "XMIL", weight: "100" }],
    frequency: "week",
    day: dayOfWeek(todayOn) === 0 ? 7 : dayOfWeek(todayOn),
    startOn: todayOn,
    fee: { amount: "1.00" },
    ...over,
  });

  /** The market of `instrument` closes at `close` today, on the instance's source of prices. */
  async function closeToday(listingId: string, close: string) {
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

  /** Another public example ISIN, with its own market. */
  async function otherInstrument() {
    const registers = (async (input: string | URL | Request) => {
      const answer = await REGISTERS(input);
      return new Response((await answer.text()).replace("BBG000000001", "BBG000000002"));
    }) as typeof globalThis.fetch;
    const [hit] = (await searchInstruments("US5949181045", { fetch: registers, priceSourceId: "prices" }))
      .items;
    return { instrumentId: hit.instrumentId, listingId: hit.listings[0].listingId };
  }

  it("lists a plan as the MCP tool does, and writes its execution when the person confirms it", async () => {
    const accountId = await portfolio();
    const base = `/investments/${accountId}/plans`;
    await send(alice, "POST", `/investments/${accountId}/operations`, {
      kind: "deposit",
      on: todayOn,
      amount: "1000.00",
    });
    // The body of R5d is refused.
    expect(await send(alice, "POST", base, plan({ quantity: "1" }))).toMatchObject({ status: 400 });
    const other = await otherInstrument();
    const priced = [{ instrumentId: other.instrumentId, mic: "XMIL", weight: "100" }];
    const made = await send(alice, "POST", base, plan({ instruments: priced }));
    expect(made.status).toBe(201);
    const listed = await send(alice, "GET", base);
    expect(listed.body.plans).toMatchObject([
      { id: made.body.id, amount: "100.00", fee: { amount: "1.00", rate: null }, nextDueOn: todayOn },
    ]);
    expect(listed.body.plans[0]).toMatchObject({ currency: "EUR", model: "basket", carry: "0.00" });
    const tool = reads.find((one) => one.name === "list_investment_plans")!;
    expect(await tool.run(alice, { account_id: accountId })).toEqual(listed.body);
    // A fee in percent, as the funds' (0,19 %), and no past due date for a plan that starts today.
    const rated = await send(
      alice,
      "POST",
      base,
      plan({ name: "Rated", instruments: priced, fee: { rate: "0.19" } }),
    );
    expect((await send(alice, "GET", base)).body.plans).toContainEqual(
      expect.objectContaining({ id: rated.body.id, fee: { amount: null, rate: "0.19" } }),
    );
    expect((await send(alice, "GET", `${base}/${made.body.id}/backfill`)).body).toEqual({
      planId: made.body.id,
      currency: "EUR",
      runs: [],
      more: false,
    });

    // No price yet: the execution waits for one; with the close of today it is a proposal.
    await runDuePlans(alice);
    const waiting = await send(alice, "GET", `${base}/${made.body.id}/runs`);
    expect(waiting.body.runs).toMatchObject([
      { state: "waiting_price", currency: "EUR", proposal: null, automatic: false, lines: [] },
    ]);
    await closeToday(other.listingId, "40");
    await runDuePlans(alice);
    const runs = await send(alice, "GET", `${base}/${made.body.id}/runs`);
    expect(runs.body.runs).toMatchObject([
      { state: "proposed", budget: "100.00", lines: [{ quantity: "2", spent: "80.00", state: "buy" }] },
    ]);
    const run = `${base}/${made.body.id}/runs/${runs.body.runs[0].id}`;
    const assetId = runs.body.runs[0].lines[0].assetId;
    const preview = await send(alice, "POST", `${run}/preview`, { lines: [{ assetId, unitPrice: "30" }] });
    expect(preview.body).toMatchObject({ spent: "90.00", carryOut: "10.00", lines: [{ quantity: "3" }] });
    const bought = await send(alice, "POST", `${run}/confirm`, {
      lines: [{ assetId, quantity: "2", unitPrice: "40" }],
    });
    expect(bought.status).toBe(201);
    expect(
      await send(alice, "POST", `${run}/confirm`, { lines: [{ assetId, quantity: "1", unitPrice: "40" }] }),
    ).toMatchObject({
      status: 409,
      body: { reason: "not_editable" },
    });
    const activity = await send(alice, "GET", `/investments/${accountId}/activity?period=all`);
    expect(activity.body.rows.find((row: Json) => row.id === bought.body.id)).toMatchObject({
      leg: { kind: "buy", quantity: "2.000000000000000000" },
      plan: { planId: made.body.id, name: "Weekly ETF", automatic: false },
    });
    // 1000 in, 80 of shares and 1 of fee out (D1); 20 carried to the next execution.
    expect((await send(alice, "GET", `/investments/${accountId}/holdings`)).body.cash).toBe("919.00");
    expect(
      (await send(alice, "GET", base)).body.plans.find((one: Json) => one.id === made.body.id),
    ).toMatchObject({
      carry: "20.00",
    });
    expect(
      await send(alice, "POST", `${base}/${made.body.id}/backfill`, {
        runs: [{ dueOn: todayOn, on: todayOn, quantity: "1", unitPrice: "40" }],
      }),
    ).toMatchObject({ status: 400, body: { reason: "plan_model_retired" } });

    const paused = await send(alice, "PATCH", `${base}/${made.body.id}`, { state: "paused" });
    expect(paused.status).toBe(204);
    expect(
      (await send(alice, "GET", base)).body.plans.find((one: Json) => one.id === made.body.id),
    ).toMatchObject({
      state: "paused",
      nextDueOn: null,
    });
  });

  it("asks «Da fare» to confirm a proposal, and writes nothing when the cash is short", async () => {
    const other = await otherInstrument();
    await closeToday(other.listingId, "40");
    const accountId = await portfolio();
    const base = `/investments/${accountId}/plans`;
    const made = await send(
      alice,
      "POST",
      base,
      plan({ instruments: [{ instrumentId: other.instrumentId, mic: "XMIL", weight: "100" }] }),
    );
    expect(made.status).toBe(201);
    await runDuePlans(alice);
    const todo = await send(alice, "GET", "/todo");
    expect(todo.body.items).toMatchObject([
      {
        event: "plan_run_to_confirm",
        params: { date: todayOn },
        target: { page: "investment_plan", id: accountId },
      },
    ]);
    const [run] = (await send(alice, "GET", `${base}/${made.body.id}/runs`)).body.runs;
    const refused = await send(alice, "POST", `${base}/${made.body.id}/runs/${run.id}/confirm`, {
      lines: [{ assetId: run.lines[0].assetId, quantity: "2", unitPrice: "40" }],
    });
    expect(refused).toMatchObject({ status: 409, body: { reason: "negative_cash" } });
    expect((await send(alice, "GET", `${base}/${made.body.id}/runs`)).body.runs).toMatchObject([
      { state: "proposed", lines: [{ eventId: null }] },
    ]);
  });

  /** A basket proposed with one line with no price (§6): the confirm path, that line and a priced one. */
  async function proposalWithNoPrice() {
    const other = await otherInstrument();
    await closeToday(other.listingId, "40");
    const accountId = await portfolio();
    await send(alice, "POST", `/investments/${accountId}/operations`, {
      kind: "deposit",
      on: todayOn,
      amount: "1000.00",
    });
    const base = `/investments/${accountId}/plans`;
    // Another public example ISIN, on a market with no source of prices.
    const unpriced = (async (input: string | URL | Request) => {
      const answer = await REGISTERS(input);
      return new Response(
        (await answer.text()).replace("BBG000000001", "BBG000000003").replace("EXA", "EXC"),
      );
    }) as typeof globalThis.fetch;
    const [third] = (await searchInstruments("US0231351067", { fetch: unpriced, priceSourceId: null })).items;
    // A monthly basket due today, one of its markets with no close: a proposal after 5 working days.
    const instruments = [
      { instrumentId: third.instrumentId, mic: "XMIL", weight: "50" },
      { instrumentId: other.instrumentId, mic: "XMIL", weight: "50" },
    ];
    const made = await send(
      alice,
      "POST",
      base,
      plan({ instruments, frequency: "month", day: Number(todayOn.slice(8, 10)) }),
    );
    expect(made.status).toBe(201);
    await runDuePlans(alice);
    await runDuePlans(alice, new Date(`${addDays(todayOn, 10)}T11:00:00Z`));
    const [run] = (await send(alice, "GET", `${base}/${made.body.id}/runs`)).body.runs;
    const missing = run.lines.find((line: Json) => line.state === "price_missing");
    const priced = run.lines.find((line: Json) => line.state === "buy");
    expect(run.state).toBe("proposed");
    return {
      base,
      planId: made.body.id as string,
      confirm: `${base}/${made.body.id}/runs/${run.id}/confirm`,
      missing,
      bought: { assetId: priced.assetId, quantity: "1", unitPrice: "40" },
    };
  }

  it("confirms a line with no price at 0 shares, and refuses shares with no price (PERS-714)", async () => {
    const { base, planId, confirm, missing, bought } = await proposalWithNoPrice();
    expect(
      await send(alice, "POST", confirm, { lines: [{ assetId: missing.assetId, quantity: "1" }, bought] }),
    ).toMatchObject({ status: 400, body: { error: "invalid" } });
    const confirmed = await send(alice, "POST", confirm, {
      lines: [{ assetId: missing.assetId, quantity: "0" }, bought],
    });
    expect(confirmed).toMatchObject({ status: 201, body: { ids: [expect.any(String)] } });
    const [recorded] = (await send(alice, "GET", `${base}/${planId}/runs`)).body.runs;
    expect(recorded).toMatchObject({ state: "recorded", carryOut: "60.00" });
  });

  it("refuses a fee on a line with 0 shares, and takes a fee of 0 (PERS-729)", async () => {
    const { confirm, missing, bought } = await proposalWithNoPrice();
    expect(
      await send(alice, "POST", confirm, {
        lines: [{ assetId: missing.assetId, quantity: "0", fee: "1.00" }, bought],
      }),
    ).toMatchObject({ status: 400, body: { error: "invalid" } });
    const confirmed = await send(alice, "POST", confirm, {
      lines: [{ assetId: missing.assetId, quantity: "0", fee: "0.00" }, bought],
    });
    expect(confirmed).toMatchObject({ status: 201, body: { ids: [expect.any(String)] } });
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

describe("the first price of a market just entered (PERS-694)", () => {
  /** An instrument whose market the instance's source of prices reads. */
  async function pricedInstrument(): Promise<string> {
    const registers = (async (input: string | URL | Request) => {
      const answer = await REGISTERS(input);
      const text = (await answer.text()).replace("BBG000000001", "BBG000000003");
      return new Response(text.replace('"EXA"', '"EXB"').replace("Example ETF", "Other ETF"));
    }) as typeof globalThis.fetch;
    const [hit] = (await searchInstruments("US5949181045", { fetch: registers, priceSourceId: "prices" }))
      .items;
    return hit.instrumentId;
  }

  /** A portfolio with money in, and the operations' path. */
  async function funded(): Promise<{ accountId: string; ops: string }> {
    const accountId = await portfolio();
    const ops = `/investments/${accountId}/operations`;
    await send(alice, "POST", ops, { kind: "deposit", on: todayOn, amount: "1000.00" });
    return { accountId, ops };
  }

  /** What the queued `instrument-prices` does, with a fake source: every close at 50 today. */
  async function runPricesJob(): Promise<void> {
    const run = await refreshPrices({
      source: {
        id: "prices",
        closes: async (request) => ({
          bars: request.listings.map((one) => ({ key: one.key, on: todayOn, close: "50", currency: "EUR" })),
          errors: [],
        }),
      },
      markets: await pricedMarkets(alice),
      today: todayOn,
      cap: 10,
    });
    await revalueAfterPrices(alice, run);
  }

  it("queues the read of a new market once, and none for a market already priced", async () => {
    const { accountId, ops } = await funded();
    const pricedId = await pricedInstrument();
    expect((await send(alice, "POST", ops, { ...buy("1", "40"), instrumentId: pricedId })).status).toBe(201);
    expect(queuedPrices).toBe(1);
    await runPricesJob();
    const holdings = await send(alice, "GET", `/investments/${accountId}/holdings`);
    expect(holdings.body.holdings[0]).toMatchObject({
      value: "50.00",
      asset: { price: { mode: "auto", on: todayOn } },
    });
    expect((await send(alice, "POST", ops, { ...buy("1", "40"), instrumentId: pricedId })).status).toBe(201);
    expect(queuedPrices).toBe(1);
    // A market no source reads has no read to queue.
    expect(await send(alice, "POST", ops, buy("1", "40"))).toMatchObject({
      status: 201,
      body: { id: expect.any(String) },
    });
    expect(queuedPrices).toBe(1);
  });

  it("queues the read when an edit moves a purchase to a new market", async () => {
    const { ops } = await funded();
    const bought = await send(alice, "POST", ops, buy("1", "40"));
    expect(queuedPrices).toBe(0);
    const pricedId = await pricedInstrument();
    const edited = await send(alice, "PATCH", `${ops}/${bought.body.id}`, {
      ...buy("1", "40"),
      instrumentId: pricedId,
    });
    expect(edited).toMatchObject({ status: 204, body: null });
    expect(queuedPrices).toBe(1);
  });

  it("keeps the purchase when the read cannot be queued: the daily job reads it", async () => {
    const { accountId, ops } = await funded();
    queueFails = true;
    const bought = await send(alice, "POST", ops, {
      ...buy("1", "40"),
      instrumentId: await pricedInstrument(),
    });
    expect(bought.status).toBe(201);
    const activity = await send(alice, "GET", `/investments/${accountId}/activity?period=all`);
    expect(activity.body.rows.map((row: Json) => row.id)).toContain(bought.body.id);
  });
});
