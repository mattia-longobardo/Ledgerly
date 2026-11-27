// The routes of investments (rewrite plan R2, 05-refactor.md §5.5): page = route = MCP tool, each
// Server Action's use case through its route, and the writes that name an event or a reading by id
// held to the service of their path and to its person. The guard is the test's: `session.itest.ts`
// and `exposure.itest.ts` prove the tokens and the session's routes.
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { getDb } from "@domain/platform/db/client";
import { addDays, today } from "@domain/shared/dates";
import { centsToDecimal, parseDecimal } from "@domain/shared/money";
import type { InvestmentSource, KeyCheck } from "@domain/platform/integrations/investments/source";
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
const investments = await import("@ledgerly/domain/investments");
const { addAsset, saveReading } = await import("@domain/modules/investments/service");
const { investmentEvents, investmentReadings, investmentReconciliations } =
  await import("@domain/modules/investments/schema");
const { setSourcesForTests } = await import("@domain/modules/investments/sync");
const { assetsService, connectTarget, engineService, manualService } =
  await import("../../../../../test/investments");
const { numberSeparators, parseAmount } = await import("@domain/platform/format");

/**
 * What the Server Action of a sale did, line for line, before R3 deleted it: the fields typed in the
 * person's number format, read into cents and fixed-point decimals, then the use case.
 */
const actions = {
  async recordOperationAction(
    accountId: string,
    input: {
      kind: "sell";
      holdingId: string;
      on: string;
      quantity: string;
      unitPrice: string;
      fee: string;
      amount: string;
      note: string;
    },
  ) {
    const ctx = signedIn;
    const separators = numberSeparators(ctx.numberFormat);
    const number = (typed: string, scale: number) =>
      typed.trim() === "" ? null : parseDecimal(investments.plainDecimal(typed, separators), scale);
    const quantity = number(input.quantity, investments.QUANTITY_SCALE);
    const unitPrice = number(input.unitPrice, investments.PRICE_SCALE);
    await investments.recordOperation(ctx, accountId, {
      kind: input.kind,
      holdingId: input.holdingId,
      on: input.on,
      quantity,
      unitPrice: quantity === null ? null : unitPrice,
      amountCents:
        quantity === null || unitPrice === null
          ? input.amount.trim() === ""
            ? null
            : parseAmount(input.amount, ctx.numberFormat)
          : null,
      feeCents: input.fee.trim() === "" ? 0n : parseAmount(input.fee, ctx.numberFormat),
      note: input.note,
    });
    return { ok: true };
  },
};
const { createAccount } = await import("@domain/modules/accounts/service");

const qty = (value: string) => parseDecimal(value, investments.QUANTITY_SCALE);
const price = (value: string) => parseDecimal(value, investments.PRICE_SCALE);
const eur = (value: number) => BigInt(Math.round(value * 100));

/** What the routes queued: «Sync now» and the first flows of a connection. */
let queued: string[] = [];
let keyCheck: KeyCheck["result"] = "read-only";

async function send(ctx: Ctx, method: string, path: string, body?: unknown) {
  const routes = apiRoutes({
    ...adapters,
    guard: () => async (context, next) => {
      context.set("ctx", ctx);
      await next();
    },
    investments: {
      queueSync: async (_ctx, connectionId) => void queued.push(`sync:${connectionId}`),
      queueFirstFlows: async (_ctx, connectionId) => void queued.push(`flows:${connectionId}`),
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

/** A provider that reads one empty account: enough for the key, the connection and a pass. */
function fakeSource(): InvestmentSource {
  return {
    async verifyReadOnly() {
      return { result: keyCheck, permissions: {}, ipRestricted: null, externalAccountId: "ext-1" };
    },
    async fetchHoldings() {
      return {
        observedAt: new Date(),
        externalAccountId: "ext-1",
        totalCents: 0n,
        cashCents: 0n,
        positions: [],
        scopes: [{ product: "trading", complete: true }],
        empty: true,
        complete: true,
      };
    },
    async fetchFlows() {
      return { events: [], coverage: [] };
    },
    async fetchHistory() {
      return { points: [], coverage: [] };
    },
  };
}

let alice: Ctx;
let bob: Ctx;
let todayOn: string;

beforeEach(async () => {
  await resetDatabase();
  alice = contextFor((await createTestUser()).id);
  bob = contextFor((await createTestUser()).id);
  signedIn = alice;
  todayOn = today(alice.timeZone);
  queued = [];
  keyCheck = "read-only";
  setSourcesForTests(() => fakeSource());
});
afterEach(() => {
  setSourcesForTests(null);
  vi.useRealTimers();
});
afterAll(closeDatabase);

/** A service kept by asset, with ten units of one ETF bought today. */
async function byAsset(ctx: Ctx, name = "Directa") {
  const { accountId } = await assetsService(ctx, { name, category: "broker", currency: "EUR" });
  await addAsset(ctx, accountId, {
    asset: {
      create: { class: "etf", name: `${name} World`, symbol: `${name.slice(0, 3)}W`, currency: "EUR" },
    },
    on: todayOn,
    quantity: qty("10"),
    unitPrice: price("100"),
  });
  const detail = await investments.serviceDetail(ctx, accountId);
  return { accountId, holdingId: detail!.holdings[0].id };
}

/** A service kept as a total, with money in and its value. */
async function byTotal(ctx: Ctx, name: string, inCents: bigint, valueCents: bigint) {
  const { accountId } = await engineService(ctx, { name, category: "broker", currency: "EUR" });
  await investments.recordOperation(ctx, accountId, { kind: "deposit", on: todayOn, amountCents: inCents });
  await investments.recordOperation(ctx, accountId, {
    kind: "account_valuation",
    on: todayOn,
    amountCents: valueCents,
  });
  return accountId;
}

/** Two services and a withdrawal of one that is a deposit of the other. */
async function transferPair(ctx: Ctx) {
  const from = await byTotal(ctx, "Fineco", eur(10_000), eur(10_000));
  const to = await byTotal(ctx, "Mediolanum", eur(1), eur(1));
  const { eventId: withdrawalId } = await investments.recordOperation(ctx, from, {
    kind: "withdrawal",
    on: todayOn,
    amountCents: eur(2_000),
  });
  const { eventId: depositId } = await investments.recordOperation(ctx, to, {
    kind: "deposit",
    on: todayOn,
    amountCents: eur(2_000),
  });
  return { from, to, withdrawalId, depositId };
}

describe("the reads of investments", () => {
  it("answer the numbers the pages read, and the MCP tools the same", async () => {
    const { accountId } = await byAsset(alice);
    const total = await byTotal(alice, "Fineco", eur(1_000), eur(1_050));

    const list = await send(alice, "GET", "/investments?period=all");
    expect(list.status).toBe(200);
    expect(await tool("list_investments").run(alice, { period: "all" })).toEqual(list.body);
    // Modified Dietz of the period: the home's and the Overview's own, rounded like every ratio.
    const view = await investments.investmentsPnlView(alice, { period: "all" });
    const ratio = (value: number | null) => (value === null ? null : Number(value.toFixed(6)));
    expect(list.body.pnl.modifiedDietz).toBe(ratio(view.portfolio.rate));
    const fineco = view.portfolio.services.find((one) => one.accountId === total)!;
    expect(
      list.body.pnl.services.find((one: { accountId: string }) => one.accountId === total),
    ).toMatchObject({
      modifiedDietz: ratio(fineco.displayReturn?.dietz ?? null),
    });

    const holdings = await send(alice, "GET", `/investments/${accountId}/holdings`);
    expect(holdings.status).toBe(200);
    expect(await tool("get_investment_holdings").run(alice, { account_id: accountId })).toEqual(
      holdings.body,
    );

    // The home: the page's two queries, summed as the page sums them.
    const home = await send(alice, "GET", "/investments/home?period=all");
    expect(home.status).toBe(200);
    expect(home.body.pnl.parts.pnl).toBe(centsToDecimal(view.portfolio.parts!.pnlCents));
    expect(home.body.services.map((one: { accountId: string }) => one.accountId).sort()).toEqual(
      [accountId, total].sort(),
    );
    expect(home.body.totals.value).toBe(
      centsToDecimal((await investments.investmentsHome(alice)).totals.valueCents!),
    );

    const overview = await send(alice, "GET", `/investments/${total}?period=all`);
    expect(overview.status).toBe(200);
    expect(await tool("get_investment").run(alice, { account_id: total, period: "all" })).toEqual(
      overview.body,
    );
    expect(overview.body.pnl.display.pnl).toBe(centsToDecimal(fineco.display!.pnlCents));

    const positions = await send(alice, "GET", `/investments/${accountId}/positions?period=all`);
    expect(positions.status).toBe(200);
    const measured = (await investments.servicePositions(alice, accountId, { period: "all" }))!;
    expect(positions.body.open.rows.map((row: { at: { value: string | null } }) => row.at.value)).toEqual(
      measured.service.holdings.flatMap((row) =>
        row.end === null ? [] : [row.end.valueCents === null ? null : centsToDecimal(row.end.valueCents)],
      ),
    );
    expect(positions.body.contributions?.total ?? null).toBe(
      measured.service.local ? centsToDecimal(measured.service.local.pnlCents) : null,
    );

    const activity = await send(alice, "GET", `/investments/${accountId}/activity?period=all`);
    expect(activity.status).toBe(200);
    const span = (await investments.servicePnlView(alice, accountId, { period: "all" }))!.span;
    const events = (await investments.serviceActivity(alice, accountId, {
      ...span,
      family: null,
      q: null,
      assetId: null,
      page: 1,
    }))!;
    expect(activity.body).toMatchObject({ source: "events", total: events.total, allTime: events.allTime });
    expect(activity.body.rows.map((row: { id: string }) => row.id)).toEqual(events.rows.map((row) => row.id));

    // The catalog lists the providers to come too, each with its status, as the page shows them.
    const catalog = await send(alice, "GET", "/investments/catalog");
    expect(catalog.status).toBe(200);
    expect(catalog.body.providers.map((one: { id: string; status: string }) => [one.id, one.status])).toEqual(
      (await investments.catalogView(alice)).providers.map((one) => [one.id, one.status]),
    );
    // R5b (decision B1c): no entry to come, only what can be connected.
    expect(catalog.body.providers.some((one: { status: string }) => one.status === "planned")).toBe(false);
    expect((await send(alice, "GET", `/investments/${accountId}/connection`)).status).toBe(200);
    // Another person's service does not exist; a year to come and a malformed id are refused.
    expect((await send(bob, "GET", `/investments/${accountId}?period=all`)).status).toBe(404);
    expect((await send(alice, "GET", "/investments/home?period=2999")).status).toBe(400);
    expect((await send(alice, "GET", "/investments/not-a-uuid/holdings")).status).toBe(400);
    // The legacy query reads what it can: a malformed range is the year running.
    expect((await send(alice, "GET", "/investments?from=2026-13-45&to=nope")).body.pnl.period.kind).toBe(
      "year",
    );
  });
});

describe("the writes of investments", () => {
  /** The legs of an event as stored, without what makes two events two. */
  const legsOf = async (ctx: Ctx, accountId: string, eventId: string) => {
    const detail = await investments.serviceDetail(ctx, accountId);
    const row = detail!.operations.find((one) => one.id === eventId)!;
    return {
      note: row.note,
      legs: row.legs.map(({ kind, leg, quantityText, priceText, amountCents }) => ({
        kind,
        leg,
        quantityText,
        priceText,
        amountCents,
      })),
    };
  };

  it("record and delete an operation as the Server Action does", async () => {
    const { accountId, holdingId } = await byAsset(alice);
    const recorded = await send(alice, "POST", `/investments/${accountId}/operations`, {
      kind: "sell",
      holdingId,
      on: todayOn,
      quantity: "2",
      unitPrice: "130.5",
      fee: "1.50",
    });
    expect(recorded.status).toBe(201);
    // The same sale typed in the person's format (it-IT) through the action.
    expect(
      await actions.recordOperationAction(accountId, {
        kind: "sell",
        holdingId,
        on: todayOn,
        quantity: "2",
        unitPrice: "130,5",
        fee: "1,50",
        amount: "",
        note: "",
      }),
    ).toEqual({ ok: true });
    const detail = await investments.serviceDetail(alice, accountId);
    const fromAction = detail!.operations.find((one) => one.kind === "sell" && one.id !== recorded.body.id)!;
    expect(await legsOf(alice, accountId, recorded.body.id)).toEqual(
      await legsOf(alice, accountId, fromAction.id),
    );

    expect(
      (await send(alice, "DELETE", `/investments/${accountId}/operations/${recorded.body.id}`)).status,
    ).toBe(204);
    const after = await investments.serviceDetail(alice, accountId);
    expect(after!.operations.map((one) => one.id)).not.toContain(recorded.body.id);
  });

  it("refuse what comes from Accounts or the provider, and a service that does not exist", async () => {
    const { accountId, holdingId } = await byAsset(alice);
    for (const kind of ["deposit", "withdrawal", "account_valuation", "adjustment"]) {
      expect(
        await send(alice, "POST", `/investments/${accountId}/operations`, {
          kind,
          on: todayOn,
          amount: "1.00",
        }),
      ).toEqual({ status: 409, body: { error: "conflict", reason: "not_editable" } });
    }
    const income = { kind: "income", holdingId, on: todayOn, amount: "5.00" };
    expect((await send(bob, "POST", `/investments/${accountId}/operations`, income)).status).toBe(404);
    expect(
      (await send(alice, "POST", "/investments/00000000-0000-7000-8000-000000000000/operations", income))
        .status,
    ).toBe(404);
    expect(
      await send(alice, "POST", `/investments/${accountId}/operations`, {
        ...income,
        on: addDays(todayOn, 1),
      }),
    ).toEqual({ status: 400, body: { error: "invalid", reason: "future_date" } });
    const recorded = await send(alice, "POST", `/investments/${accountId}/operations`, income);
    expect(recorded.status).toBe(201);
    // A service a provider syncs is the provider's to write: no edit, even of an operation typed by hand.
    expect(
      await send(alice, "PATCH", `/investments/${accountId}/operations/${recorded.body.id}`, {
        ...income,
        amount: "6.00",
      }),
    ).toEqual({ status: 409, body: { error: "conflict", reason: "not_editable" } });
  });

  it("make a manual service, change its address and its value", async () => {
    const { accountId: existing } = await manualService(alice, {
      name: "Directa",
      category: "broker",
      currency: "EUR",
    });
    const account = await createAccount(alice, { name: "Fineco", type: "investment", currency: "EUR" });
    const created = await send(alice, "POST", "/investments", { accountId: account.id, category: "broker" });
    expect(created).toEqual({ status: 201, body: { accountId: account.id } });
    expect(await send(alice, "POST", "/investments", { accountId: account.id, category: "broker" })).toEqual({
      status: 409,
      body: { error: "conflict", reason: "not_eligible" },
    });

    expect((await send(alice, "PATCH", `/investments/${existing}`, { url: "directa.it" })).status).toBe(204);
    expect(
      (await send(alice, "PUT", `/investments/${existing}/value`, { on: todayOn, amount: "1234.56" })).status,
    ).toBe(204);
    const overview = await send(alice, "GET", `/investments/${existing}`);
    expect(overview.body.service).toMatchObject({
      url: "https://directa.it",
      manualPnl: { value: "1234.56", valuedOn: todayOn },
    });
    expect((await send(bob, "PATCH", `/investments/${existing}`, { url: "" })).status).toBe(404);
  });

  it("reconcile a manual position and confirm an empty reading", async () => {
    const { accountId, holdingId } = await byAsset(alice);
    expect(
      (
        await send(alice, "POST", `/investments/${accountId}/holdings/${holdingId}/reconciliation`, {
          kind: "reopened",
          effectiveOn: todayOn,
        })
      ).status,
    ).toBe(204);
    const decisions = await getDb()
      .select()
      .from(investmentReconciliations)
      .where(eq(investmentReconciliations.holdingId, holdingId));
    expect(decisions.map((row) => row.kind)).toEqual(["reopened"]);

    const { readingId } = await saveReading(alice, accountId, {
      on: todayOn,
      observedAt: new Date(),
      status: "pending_zero",
      totalCents: 0n,
      positions: [],
      scopes: [{ externalAccountId: "ext-1", product: "spot", complete: true }],
    });
    expect((await send(alice, "POST", `/investments/${accountId}/readings/${readingId}/zero`)).status).toBe(
      204,
    );
    const [reading] = await getDb()
      .select()
      .from(investmentReadings)
      .where(eq(investmentReadings.id, readingId));
    expect(reading.status).toBe("confirmed_zero");
  });

  it("link and unlink a transfer between two services", async () => {
    const { from, to, withdrawalId, depositId } = await transferPair(alice);
    const linked = await send(alice, "POST", `/investments/${from}/transfers`, { withdrawalId, depositId });
    expect(linked.status).toBe(201);
    const groups = async () =>
      (await getDb().select().from(investmentEvents).where(eq(investmentEvents.userId, alice.userId)))
        .filter((row) => row.transferGroupId !== null)
        .map((row) => [row.id, row.transferGroupId]);
    expect((await groups()).sort()).toEqual(
      [
        [withdrawalId, linked.body.id],
        [depositId, linked.body.id],
      ].sort(),
    );
    expect((await send(alice, "DELETE", `/investments/${to}/transfers/${depositId}`)).status).toBe(204);
    expect(await groups()).toEqual([]);
  });

  it("connect a provider, sync, check and replace the key, disconnect, confirm the revocation", async () => {
    const target = await connectTarget(alice, { name: "eToro", category: "broker", currency: "EUR" });
    const credentials = { api_key: "public-key", user_key: "user-key" };
    const connected = await send(alice, "POST", "/investments/connections", {
      provider: "etoro",
      credentials,
      target,
    });
    expect(connected).toEqual({ status: 201, body: { accountId: target.accountId, ipRestricted: null } });
    expect(queued).toEqual([expect.stringMatching(/^flows:/)]);
    const connectionId = queued[0].slice("flows:".length);

    const path = `/investments/${target.accountId}`;
    const synced = await send(alice, "POST", `${path}/sync`);
    expect([202, 409]).toContain(synced.status);
    if (synced.status === 202) expect(queued).toContain(`sync:${connectionId}`);
    else expect(synced.body).toEqual({ error: "conflict", reason: "cooldown" });

    // The connection checked the key a moment ago: a minute must pass (SEC-09). Only `Date` is faked.
    expect(await send(alice, "POST", `${path}/key/check`)).toEqual({
      status: 409,
      body: { error: "conflict", reason: "cooldown" },
    });
    const later = (minutes: number) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + minutes * 60_000);
    };
    later(2);
    expect((await send(alice, "POST", `${path}/key/check`)).status).toBe(204);
    later(2);
    keyCheck = "write";
    expect(await send(alice, "POST", `${path}/key/check`)).toEqual({
      status: 409,
      body: { error: "conflict", reason: "not_read_only" },
    });
    keyCheck = "read-only";
    later(2);
    expect((await send(alice, "PUT", `${path}/key`, { credentials })).status).toBe(204);
    expect((await send(alice, "DELETE", `${path}/connection`)).status).toBe(204);
    expect(await send(alice, "POST", `${path}/sync`)).toEqual({
      status: 409,
      body: { error: "conflict", reason: "not_connected" },
    });
    expect((await send(alice, "POST", `${path}/key/revoked`)).status).toBe(204);
    const connection = await send(alice, "GET", `${path}/connection`);
    expect(connection.body.sync).toMatchObject({ connected: false, revokePending: false });
  });
});

describe("a write that names an event or a reading by id", () => {
  /** Alice's services and their ids, and what a re-read of them gives. */
  async function setUp() {
    const pair = await transferPair(alice);
    const { accountId, holdingId } = await byAsset(alice, "Degiro");
    const { eventId } = await investments.recordOperation(alice, accountId, {
      kind: "income",
      holdingId,
      on: todayOn,
      amountCents: eur(5),
    });
    const { readingId } = await saveReading(alice, accountId, {
      on: todayOn,
      observedAt: new Date(),
      status: "pending_zero",
      totalCents: 0n,
      positions: [],
      scopes: [{ externalAccountId: "ext-1", product: "spot", complete: true }],
    });
    await investments.linkTransfer(alice, { withdrawalId: pair.withdrawalId, depositId: pair.depositId });
    const state = async () => ({
      events: (await getDb().select().from(investmentEvents).where(eq(investmentEvents.userId, alice.userId)))
        .map((row) => [row.id, row.transferGroupId])
        .sort(),
      readings: (
        await getDb().select().from(investmentReadings).where(eq(investmentReadings.userId, alice.userId))
      ).map((row) => [row.id, row.status]),
    });
    return { ...pair, accountId, eventId, readingId, state };
  }

  it("is not found on another service of the same person, nor on another person's", async () => {
    const { from, to, accountId, eventId, readingId, depositId, state } = await setUp();
    const before = await state();
    // Bob's own service, with the ids of Alice's.
    const bobs = await byTotal(bob, "Bob", eur(10), eur(10));
    for (const [ctx, other] of [
      [alice, from],
      [bob, bobs],
    ] as const) {
      for (const [method, path] of [
        ["DELETE", `/investments/${other}/operations/${eventId}`],
        ["POST", `/investments/${other}/readings/${readingId}/zero`],
        ["DELETE", `/investments/${other === from ? accountId : other}/transfers/${depositId}`],
      ] as const) {
        expect(await send(ctx, method, path), `${method} ${path}`).toEqual({
          status: 404,
          body: { error: "not_found" },
        });
        expect(await state()).toEqual(before);
      }
    }
    // On its own service, and by its own person, each is found.
    expect((await send(alice, "DELETE", `/investments/${to}/transfers/${depositId}`)).status).toBe(204);
    expect((await send(alice, "POST", `/investments/${accountId}/readings/${readingId}/zero`)).status).toBe(
      204,
    );
    expect((await send(alice, "DELETE", `/investments/${accountId}/operations/${eventId}`)).status).toBe(204);
  });
});
