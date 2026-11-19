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
      changes: [
        { amount: null, fraction: null },
        { amount: null, fraction: null },
        { amount: "0.00", fraction: 0 },
      ],
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

describe("the fields of R3 accounts: every figure a screen shows is the API's", () => {
  async function record(ctx: Ctx, id: string, on: string, balance: string) {
    expect((await send(ctx, "POST", `/accounts/${id}/balances`, { on, balance })).status).toBe(201);
  }

  /** Two accounts in the net worth and one archived, over a year and a month. */
  async function history() {
    const main = await newAccount(alice, { name: "Main" });
    const side = await newAccount(alice, { name: "Side" });
    const gone = await newAccount(alice, { name: "Gone" });
    for (const [on, balance] of [
      ["2025-02-28", "100"],
      ["2025-12-31", "120"],
      ["2026-01-31", "150"],
      ["2026-02-20", "180"],
    ]) {
      await record(alice, main.id, on, balance);
    }
    await record(alice, side.id, "2026-01-31", "20");
    await record(alice, gone.id, "2026-01-31", "5");
    await send(alice, "POST", `/accounts/${gone.id}/archive`);
    return { main, side, gone };
  }

  it("names the account that has the IBAN in a refusal, and never the IBAN", async () => {
    await newAccount(alice, { iban: IBAN });
    const twice = await send(alice, "POST", "/accounts", { name: "Second", type: "checking", iban: IBAN });
    expect(twice).toEqual({
      status: 409,
      body: { error: "conflict", reason: "iban_exists", other: "Everyday" },
    });
    const other = await newAccount(alice, { name: "Other" });
    const moved = await send(alice, "PATCH", `/accounts/${other.id}`, { iban: IBAN });
    expect(moved.body).toEqual({ error: "conflict", reason: "iban_exists", other: "Everyday" });
    expect(JSON.stringify([twice, moved])).not.toContain(IBAN.slice(4));
  });

  it("gives each account's change, year over year, share and sync, and the net worth's changes", async () => {
    const { main, side, gone } = await history();
    const view = (await send(alice, "GET", "/net-worth?months=13&through=2026-02-01&includeArchived=true"))
      .body;
    const row = (id: string) => view.accounts.find((one: { id: string }) => one.id === id);
    expect(view.total).toBe("200.00");
    expect(row(main.id)).toMatchObject({
      change: { amount: "30.00", fraction: 0.2 },
      yoy: { amount: "80.00", fraction: 0.8 },
      share: 0.9,
      lastSyncedAt: null,
      service: null,
    });
    expect(row(side.id)).toMatchObject({ change: { amount: "0.00", fraction: 0 }, share: 0.1 });
    expect(row(gone.id).share).toBeNull();
    expect(view.change).toEqual({ amount: "30.00", fraction: 30 / 170 });
    expect(view.yearToDate).toEqual({ amount: "80.00", fraction: 80 / 120 });

    // Parity: what the pages work out today from the same view (`accounts/page.tsx`, `(app)/page.tsx`).
    const { accountsView } = await import("@ledgerly/domain/accounts");
    const { changeBetween, shareOf } = await import("@ledgerly/domain/accounts");
    const page = await accountsView(alice, { through: "2026-02-01", months: 13, includeArchived: true });
    const wire = (change: { cents: bigint | null; fraction: number | null }) => ({
      amount: change.cents === null ? null : (Number(change.cents) / 100).toFixed(2),
      fraction: change.fraction,
    });
    for (const one of page.rows) {
      expect(row(one.account.id)).toMatchObject({
        change: wire(changeBetween(one.balance, one.previous)),
        yoy: wire(changeBetween(one.balance, one.series.at(-13) ?? null)),
        share: one.account.state === "archived" ? null : shareOf(one.display.balance, page.total),
      });
    }
    const january = page.months.indexOf("2026-01-01");
    expect(view.change).toEqual(wire(changeBetween(page.total, page.previousTotal)));
    expect(view.yearToDate).toEqual(wire(changeBetween(page.total, page.netWorth[january - 1].total)));
  });

  it("gives the charts' changes as the client's `changeOf` worked them out", async () => {
    const { main } = await history();
    const view = (await send(alice, "GET", "/net-worth?months=13&through=2026-02-01")).body;
    const row = view.accounts.find((one: { id: string }) => one.id === main.id);
    expect(view.windowChange).toEqual({ amount: "100.00", fraction: 1 });
    expect(row.seriesChange.slice(-2)).toEqual([
      { amount: "30.00", fraction: 0.25 },
      { amount: "30.00", fraction: 0.2 },
    ]);
    const path = `/accounts/${main.id}/daily-balances?from=2026-02-19&to=2026-02-21`;
    const daily = (await send(alice, "GET", path)).body;
    expect(daily.changes).toEqual([
      { amount: null, fraction: null },
      { amount: "30.00", fraction: 0.2 },
      { amount: "0.00", fraction: 0 },
    ]);
    const days = (await send(alice, "GET", "/net-worth/daily?from=2026-01-30&to=2026-02-21")).body;

    // Parity with the client's shortcut `changeOf` (PERS-453), over the same wire figures: the
    // window's last value from its first known one, and each point from the one before.
    const cents = (value: string | null) => (value === null ? null : BigInt(Math.round(Number(value) * 100)));
    const changeOf = (last: string | null, first: string | null) => {
      const [end, start] = [cents(last), cents(first)];
      if (end === null || start === null) return { amount: null, fraction: null };
      const amount = end - start;
      return {
        amount: (Number(amount) / 100).toFixed(2),
        fraction: start === 0n ? null : Number(amount) / Math.abs(Number(start)),
      };
    };
    const firstKnown = (values: (string | null)[]) => values.find((value) => value !== null) ?? null;
    const steps = (values: (string | null)[]) =>
      values.map((value, index) => changeOf(value, index > 0 ? values[index - 1] : null));
    const totals = view.netWorth.map((point: { total: string | null }) => point.total);
    expect(view.windowChange).toEqual(changeOf(totals.at(-1) ?? null, firstKnown(totals)));
    expect(days.windowChange).toEqual(changeOf(days.total.at(-1) ?? null, firstKnown(days.total)));
    for (const one of view.accounts) expect(one.seriesChange).toEqual(steps(one.series));
    expect(daily.changes).toEqual(steps(daily.values));
  });

  it("gives each balance its change from the one before, also the oldest of a page", async () => {
    const { main } = await history();
    const two = (await send(alice, "GET", `/accounts/${main.id}/balances?limit=2`)).body.balances;
    expect(two.map((entry: { change: unknown }) => entry.change)).toEqual([
      { amount: "30.00", fraction: 0.2 },
      { amount: "30.00", fraction: 0.25 },
    ]);
    const all = (await send(alice, "GET", `/accounts/${main.id}/balances`)).body.balances;
    expect(all.at(-1).change).toEqual({ amount: null, fraction: null });
    // Parity with the page's table (`entryRows`): each entry from the next older one.
    const { changeBetween } = await import("@ledgerly/domain/accounts");
    const amounts = ["180", "150", "120", "100"].map((value) => BigInt(value) * 100n);
    expect(all.map((entry: { change: { fraction: number | null } }) => entry.change.fraction)).toEqual(
      amounts.map((cents, index) => changeBetween(cents, amounts[index + 1] ?? null).fraction),
    );
  });

  it("gives the net worth day by day in the display currency, as the chart drew it", async () => {
    const { main, side } = await history();
    const daily = await send(alice, "GET", "/net-worth/daily?from=2026-01-30&to=2026-02-01");
    expect(daily.body).toEqual({
      currency: "EUR",
      days: ["2026-01-30", "2026-01-31", "2026-02-01"],
      total: ["120.00", "170.00", "170.00"],
      estimated: [false, false, false],
      windowChange: { amount: "50.00", fraction: 50 / 120 },
      accounts: [
        { id: main.id, values: ["120.00", "150.00", "150.00"], estimated: [false, false, false] },
        { id: side.id, values: [null, "20.00", "20.00"], estimated: [false, false, false] },
      ],
    });
    // Parity with the chart before it read the domain's rule: each account rebuilt, then summed.
    const { reconstructedBalances } = await import("@ledgerly/domain/accounts");
    const read = await reconstructedBalances(alice, [main.id, side.id], {
      from: "2026-01-30",
      to: "2026-02-01",
    });
    const summed = read.days.map((_day, index) =>
      [main.id, side.id].reduce((sum, id) => sum + (read.series.get(id)?.values[index] ?? 0n), 0n),
    );
    expect(daily.body.total).toEqual(summed.map((cents) => (Number(cents) / 100).toFixed(2)));
    const year = await send(alice, "GET", "/net-worth/daily?from=2020-01-01&to=2026-02-01");
    expect(year.body.days).toHaveLength(366);
    expect((await send(alice, "GET", "/net-worth/daily?from=2026-02-02&to=2026-02-01")).status).toBe(400);
  });

  it("gives what the account's page reads around its figures, and the bank accounts without an IBAN", async () => {
    const account = await newAccount(alice, { iban: IBAN });
    const context = await send(alice, "GET", `/accounts/${account.id}/context`);
    expect(context).toEqual({
      status: 200,
      body: {
        providerLabel: null,
        connectionId: null,
        inInvestments: false,
        managed: false,
        pockets: [],
        subscriptions: { count: 0, monthly: "0.00" },
        interestRules: [],
        switch: null,
        switchOffer: "none",
      },
    });
    const candidates = await send(alice, "GET", `/accounts/${account.id}/switch/candidates`);
    expect(candidates).toEqual({ status: 200, body: { banks: [] } });
    expect(JSON.stringify([context.body, candidates.body])).not.toContain(IBAN.slice(4));
    expect((await send(bob, "GET", `/accounts/${account.id}/context`)).status).toBe(404);
    expect((await send(bob, "GET", `/accounts/${account.id}/switch/candidates`)).status).toBe(404);
  });
});
