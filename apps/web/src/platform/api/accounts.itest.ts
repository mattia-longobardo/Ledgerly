// The routes of accounts (rewrite plan R2, 05-refactor.md §5.5): each Server Action's use case
// through its route, the person's own data only, no IBAN in any answer (H45), and route = MCP tool.
// The guard is the test's: `api.itest.ts` proves the tokens and the scopes of `/api/v1`.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { reads, adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");

const IBAN = "IT60X0542811101000000123456";

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

const as = (ctx: Ctx) =>
  apiRoutes({
    ...adapters,
    guard: () => async (context, next) => {
      context.set("ctx", ctx);
      await next();
    },
  });

async function send(ctx: Ctx, method: string, path: string, body?: unknown) {
  const response = await as(ctx).request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : JSON.parse(text) };
}

let alice: Ctx;
let bob: Ctx;

beforeEach(async () => {
  await resetDatabase();
  alice = contextFor((await createTestUser()).id);
  bob = contextFor((await createTestUser()).id);
});

afterAll(closeDatabase);

async function newAccount(ctx: Ctx, body: Record<string, unknown> = {}) {
  const created = await send(ctx, "POST", "/accounts", { name: "Everyday", type: "checking", ...body });
  expect(created.status).toBe(201);
  return created.body as { id: string };
}

describe("the accounts themselves", () => {
  it("creates, reads, changes, archives and restores an account, and never answers its IBAN", async () => {
    const account = await newAccount(alice, {
      iban: IBAN,
      openingBalance: { on: "2026-01-31", amount: "1200.5" },
    });
    expect(account).toMatchObject({ hasIban: true, ibanFromSource: false, inNetWorth: true });
    const patched = await send(alice, "PATCH", `/accounts/${account.id}`, {
      name: "Bills",
      lowBalance: "100",
    });
    expect(patched.body).toMatchObject({ name: "Bills", lowBalance: "100.00", hasIban: true });
    expect((await send(alice, "PATCH", `/accounts/${account.id}`, { iban: null })).body.hasIban).toBe(false);
    expect((await send(alice, "POST", `/accounts/${account.id}/archive`)).status).toBe(204);
    expect((await send(alice, "GET", `/accounts/${account.id}`)).body.state).toBe("archived");
    expect((await send(alice, "POST", `/accounts/${account.id}/restore`)).status).toBe(204);
    const list = await send(alice, "GET", "/accounts");
    expect(list.body.accounts).toEqual([expect.objectContaining({ id: account.id, balance: "1200.50" })]);
    expect(JSON.stringify([account, patched.body, list.body])).not.toContain(IBAN.slice(4));
  });

  it("keeps an account to its person, and answers a refusal with its code", async () => {
    const account = await newAccount(alice);
    expect((await send(bob, "GET", `/accounts/${account.id}`)).status).toBe(404);
    expect((await send(bob, "PATCH", `/accounts/${account.id}`, { name: "Mine" })).status).toBe(404);
    expect((await send(bob, "DELETE", `/accounts/${account.id}`)).status).toBe(404);
    const twice = await send(alice, "POST", "/accounts", { name: "Second", type: "checking", iban: "nope" });
    expect(twice).toEqual({ status: 400, body: { error: "invalid", reason: "iban_invalid" } });
    expect((await send(alice, "POST", "/accounts", { name: "", type: "checking" })).status).toBe(400);
  });
});

describe("the balances of an account", () => {
  it("records, corrects and deletes a reading, only on its own account", async () => {
    const account = await newAccount(alice);
    const other = await newAccount(alice, { name: "Savings" });
    const recorded = await send(alice, "POST", `/accounts/${account.id}/balances`, {
      on: "2026-02-28",
      balance: "10.00",
    });
    expect(recorded).toMatchObject({ status: 201, body: { balance: "10.00", source: "manual" } });
    const entry = recorded.body.id as string;
    const wrong = await send(alice, "PUT", `/accounts/${other.id}/balances/${entry}`, {
      on: "2026-02-28",
      balance: "1",
    });
    expect(wrong.status).toBe(404);
    const fixed = await send(alice, "PUT", `/accounts/${account.id}/balances/${entry}`, {
      on: "2026-02-27",
      balance: "12",
      note: "fixed",
    });
    expect(fixed.body).toMatchObject({ on: "2026-02-27", balance: "12.00", note: "fixed" });
    await send(alice, "DELETE", `/accounts/${other.id}/balances/${entry}`);
    expect((await send(alice, "GET", `/accounts/${account.id}/balances`)).body.balances).toHaveLength(1);
    expect((await send(alice, "DELETE", `/accounts/${account.id}/balances/${entry}`)).status).toBe(204);
    expect((await send(alice, "GET", `/accounts/${account.id}/balances?limit=x`)).body.balances).toEqual([]);
  });

  it("gives the views: the net worth by month and an account day by day", async () => {
    const account = await newAccount(alice, { openingBalance: { on: "2026-01-31", amount: "50" } });
    const view = await send(alice, "GET", "/net-worth?months=2&through=2026-02-01");
    expect(view.body).toMatchObject({
      months: ["2026-01-01", "2026-02-01"],
      total: "50.00",
      accounts: [expect.objectContaining({ id: account.id, bucket: "cash", series: ["50.00", "50.00"] })],
    });
    const daily = await send(
      alice,
      "GET",
      `/accounts/${account.id}/daily-balances?from=2026-01-30&to=2026-02-01`,
    );
    expect(daily.body).toEqual({
      days: ["2026-01-30", "2026-01-31", "2026-02-01"],
      values: [null, "50.00", "50.00"],
      estimated: [false, false, false],
    });
    const tooLong = await send(
      alice,
      "GET",
      `/accounts/${account.id}/daily-balances?from=2020-01-01&to=2026-02-01`,
    );
    expect(tooLong.status).toBe(400);
  });
});

describe("what hangs off an account, deletion and the snapshot", () => {
  it("adds, changes and removes a link, refusing the same name twice", async () => {
    const account = await newAccount(alice);
    const added = await send(alice, "POST", `/accounts/${account.id}/links`, {
      channel: "iban",
      name: "Power",
    });
    expect(added.status).toBe(201);
    const again = await send(alice, "POST", `/accounts/${account.id}/links`, {
      channel: "iban",
      name: "power",
    });
    expect(again).toEqual({ status: 409, body: { error: "conflict", reason: "duplicate_connection" } });
    const changed = await send(alice, "PUT", `/accounts/${account.id}/links/${added.body.id}`, {
      channel: "card",
      name: "Streaming",
    });
    expect(changed.body).toMatchObject({ channel: "card", name: "Streaming", note: null });
    expect((await send(alice, "DELETE", `/accounts/${account.id}/links/${added.body.id}`)).status).toBe(204);
    expect((await send(alice, "GET", `/accounts/${account.id}/links`)).body.links).toEqual([]);
  });

  it("deletes an account nothing rests on, and takes the snapshot of a month", async () => {
    const account = await newAccount(alice, { openingBalance: { on: "2026-01-31", amount: "50" } });
    expect((await send(alice, "GET", `/accounts/${account.id}/dependents`)).body).toEqual({
      dependents: [],
      targets: [],
    });
    const run = await send(alice, "POST", "/snapshots", { on: "2026-01-15" });
    expect(run.body).toMatchObject({ month: "2026-01-01", total: "50.00", accountsWritten: 1 });
    expect((await send(alice, "GET", "/snapshots")).body.snapshots).toHaveLength(1);
    expect((await send(alice, "DELETE", `/accounts/${account.id}`)).status).toBe(204);
    expect((await send(alice, "GET", "/accounts")).body.accounts).toEqual([]);
  });
});

describe("parity of accounts: route = MCP tool", () => {
  it("answers each read tool of accounts with what its route answers", async () => {
    const account = await newAccount(alice, { openingBalance: { on: "2026-01-31", amount: "50" } });
    const tool = (name: string) => reads.find((one) => one.name === name)!;
    expect((await tool("list_accounts").run(alice, {})) as unknown).toEqual(
      (await send(alice, "GET", "/accounts")).body,
    );
    expect(await tool("get_summary").run(alice, {})).toEqual((await send(alice, "GET", "/summary")).body);
    expect(await tool("get_account_balances").run(alice, { account_id: account.id, limit: 1 })).toEqual(
      (await send(alice, "GET", `/accounts/${account.id}/balances?limit=1`)).body,
    );
  });
});
