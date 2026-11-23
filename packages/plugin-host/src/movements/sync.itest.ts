// The Wallet sync engine against a real Postgres (spec §11), reading through the plugin served
// in-process (rewrite plan R5c). Wallet itself is a stubbed `fetch` answering with the fixtures in
// `test/fixtures/wallet/`: there is no token to call the real API with, and the real plugin still
// does the parsing, the paging and the retries.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { listAccounts, listBalanceEntries } from "@domain/modules/accounts/queries";
import { listTransactions } from "@domain/modules/transactions/queries";
import { listCategories } from "@domain/modules/transactions/taxonomy";
import type { Ctx } from "@domain/platform/context";
import { addDays } from "@domain/shared/dates";

const addMinutes = (instant: Date, minutes: number) => new Date(instant.getTime() + minutes * 60_000);
import { closeDatabase, resetDatabase } from "../../../../test/db";
import { createTestUser } from "../../../../test/users";
import {
  listConnections,
  listRuns,
  readSyncJob,
  resolveExternal,
  saveConnection,
} from "@domain/platform/integrations/service";
import { PluginCallError } from "@plugin-host/client";
import { servedSource } from "../../../../test/fixtures/wallet/served-plugin";
import type { SourceCalls } from "./calls";
import { DAILY_REREAD_MONTHS, requestSourceBackfill } from "./cursor";
import { MAX_WINDOW_REMOVAL_SHARE, RemovalRefusedError } from "./removal";
import { SyncBusyError, isSyncBusy, syncSourceNow } from "./sync";
import { WALLET_PROVIDER } from "../../../../test/fixtures/providers";

const FIXTURES = join(process.cwd(), "test/fixtures/wallet");
const fixture = (name: string): { [key: string]: unknown } =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

const CATEGORIES = fixture("categories.json");
/** A `/records` row and an `/accounts` row as Wallet sends them: this file only ever filters. */
type WireRecord = { recordDate: string; [key: string]: unknown };
type WireAccount = { id: string; [key: string]: unknown };

const ACCOUNTS = fixture("accounts.json").accounts as WireAccount[];
/** One expense, 2026-01-05, on `wa-general`, category `wc-groceries`. */
const JANUARY = fixture("records-january-first-half.json").records as WireRecord[];

/**
 * Another movement on `wa-general`, so a window can hold more than one: the brake of §7.2 reasons
 * on the *share* of a window an answer would remove, and one row out of one can only ever be an
 * empty answer.
 */
function alsoOn(recordDate: string, id: string): WireRecord {
  return {
    id,
    accountId: "wa-general",
    amount: { value: -12.5, currencyCode: "EUR" },
    recordDate,
    category: { id: "wc-groceries", name: "Spesa", group: null, color: null },
    labels: [],
    recordType: "Expense",
    recordState: "Cleared",
    note: "frutta",
    counterParty: "Fruttivendolo",
    transfer: null,
    updatedAt: null,
  };
}

/** Where the plugin finds Wallet's API. */
const API = "/wallet/v1/api";
/** A Tuesday 09:07 in Rome (spec §10.2's minute), inside the seven days after the fixture's date. */
const NOW = new Date("2026-01-06T08:07:00Z");
const TOKEN = "wallet-token-8ac31f";

interface Stub {
  /** Every path the plugin asked Wallet for, in order. */
  calls: string[];
  source: SourceCalls;
  fetch: typeof globalThis.fetch;
}

/**
 * Wallet, as far as the client can tell. `records` is filtered by the `recordDate` bounds the
 * client sends, so the window logic is exercised rather than assumed; `status` and `offline` stand
 * in for a refused token and an unreachable provider.
 */
function walletStub(
  options: {
    records?: WireRecord[];
    /** Which accounts the answer carries. Leaving one out is how Wallet says it is gone (§7.1). */
    accounts?: WireAccount[];
    status?: number;
    /** A status for `/accounts` alone: that pass fails, the movements pass still runs. */
    accountsStatus?: number;
    offline?: boolean;
  } = {},
): Stub {
  const records = options.records ?? JANUARY;
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(`${url.pathname.replace(API, "")}${url.search}`);
    if (options.offline) throw new TypeError("fetch failed");
    if (options.status) return new Response("{}", { status: options.status });
    if (url.pathname.endsWith("/accounts")) {
      if (options.accountsStatus) return new Response("{}", { status: options.accountsStatus });
      return Response.json({ accounts: options.accounts ?? ACCOUNTS });
    }
    if (url.pathname.endsWith("/categories")) return Response.json(CATEGORIES);
    const bounds = url.searchParams.getAll("recordDate");
    const from = bounds.find((one) => one.startsWith("gte."))?.slice(4) ?? "";
    const to = bounds.find((one) => one.startsWith("lte."))?.slice(4) ?? "";
    const inWindow = records.filter((row) => row.recordDate >= from && row.recordDate <= to);
    // The real API declares which date filters it applied, and translates `lte.<day>` into an
    // exclusive `lt.<day+1>T00:00Z` (measured at the collaudo). The client verifies that
    // declaration, so the stub has to make it — otherwise these tests would pass against an
    // answer that never proved it covered the window.
    return Response.json({
      records: inWindow,
      appliedRecordDateFilters: [`gte.${from}T00:00:00.000Z`, `lt.${addDays(to, 1)}T00:00:00.000Z`],
    });
  };
  // The retry policy is the plugin's and is tested there; here it must not cost 30 seconds.
  return { calls, fetch, source: servedSource(fetch) };
}

const recordCalls = (stub: Stub): string[] => stub.calls.filter((path) => path.startsWith("/records"));

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

/** Every movement, hidden and disappeared ones included: this is a sync's own bookkeeping. */
async function storedTransactions(ctx: Ctx) {
  return listTransactions(ctx, { includeHidden: true, sort: "date", direction: "asc" });
}

/**
 * The **latest** run of each kind. `listRuns` is newest first, and a test that syncs twice wants
 * the second pass: reading the map straight off the list would keep the oldest row of each kind.
 */
async function runsByKind(ctx: Ctx) {
  const latest = new Map<string, Awaited<ReturnType<typeof listRuns>>[number]>();
  for (const run of await listRuns(ctx, { limit: 50 })) {
    if (!latest.has(run.kind)) latest.set(run.kind, run);
  }
  return Object.fromEntries(latest);
}

let ctx: Ctx;
let connectionId: string;

describe("syncSourceNow", () => {
  beforeEach(async () => {
    await resetDatabase();
    ctx = contextFor((await createTestUser()).id);
    const connection = await saveConnection(ctx, {
      provider: WALLET_PROVIDER,
      credentials: { token: TOKEN },
    });
    connectionId = connection.id;
  });
  afterAll(closeDatabase);

  it("adopts the provider's accounts, stamps their balances with the reading's own day, and records both runs", async () => {
    const stub = walletStub();
    const result = await syncSourceNow(ctx, connectionId, { now: NOW, source: stub.source });

    const accounts = await listAccounts(ctx, { includeArchived: true });
    expect(accounts).toHaveLength(10);
    expect(accounts.every((account) => account.origin === "synced")).toBe(true);
    expect(accounts.every((account) => account.lastSyncedAt?.getTime() === NOW.getTime())).toBe(true);

    const general = accounts.find((account) => account.providerAccountId === "wa-general");
    expect(general).toMatchObject({ name: "Conto corrente", type: "checking", currency: "EUR" });

    const balances = (await listBalanceEntries(ctx, general!.id)).filter(
      (entry) => entry.source === "provider",
    );
    // 2026-01-06 in Rome, not the UTC day of the instant, and Wallet's own digits: 2615.39 EUR.
    expect(balances).toHaveLength(1);
    expect(balances[0].on).toBe("2026-01-06");
    expect(balances[0].balanceCents).toBe(261539n);
    expect(balances[0].availableCents).toBeNull();

    expect(result.accounts).toMatchObject({ created: 10, updated: 10, skipped: 0, removed: 0 });

    const runs = await runsByKind(ctx);
    expect(runs.accounts).toMatchObject({ state: "success", error: null });
    expect(runs.transactions).toMatchObject({ state: "success", error: null });
    expect(runs.accounts.counts).toMatchObject({ created: 10 });
    expect(runs.accounts.finishedAt).not.toBeNull();
  });

  it("does not add an account whose IBAN is already here, and the connection says which (rewrite plan N4)", async () => {
    const iban = "IT60X0542811101000000123456";
    const { createAccount } = await import("@domain/modules/accounts/service");
    const mine = await createAccount(ctx, {
      name: "Kept by hand",
      type: "savings",
      currency: "EUR",
      color: null,
      reference: "",
      iban,
      purpose: "",
      openedOn: null,
      notes: "",
      openingBalance: null,
    });
    const withNumbers = ACCOUNTS.map((account) =>
      account.id === "wa-saving"
        ? { ...account, bankAccountNumber: "IT60 X054 2811 1010 0000 0123 456" }
        : account.id === "wa-general"
          ? { ...account, bankAccountNumber: "GB82 WEST 1234 5698 7654 32" }
          : account,
    );
    await syncSourceNow(ctx, connectionId, {
      now: NOW,
      source: walletStub({ accounts: withNumbers }).source,
    });

    const accounts = await listAccounts(ctx, { includeArchived: true });
    expect(accounts.some((account) => account.providerAccountId === "wa-saving")).toBe(false);
    expect(accounts.find((account) => account.providerAccountId === "wa-general")).toMatchObject({
      iban: "GB82WEST12345698765432",
      ibanFromSource: true,
    });
    expect((await listConnections(ctx)).find((one) => one.id === connectionId)?.ibanConflicts).toEqual([
      mine.id,
    ]);

    // Without the number the account comes in, and the notice goes.
    await syncSourceNow(ctx, connectionId, {
      now: addMinutes(NOW, 60),
      source: walletStub({ accounts: ACCOUNTS }).source,
    });
    expect(
      (await listAccounts(ctx, { includeArchived: true })).some(
        (one) => one.providerAccountId === "wa-saving",
      ),
    ).toBe(true);
    expect((await listConnections(ctx)).find((one) => one.id === connectionId)?.ibanConflicts).toBeNull();
  });

  it("reads twelve monthly windows on the first link and only the last seven days afterwards", async () => {
    const first = walletStub();
    await syncSourceNow(ctx, connectionId, { now: NOW, source: first.source });

    expect(recordCalls(first)).toHaveLength(12);
    expect(recordCalls(first)[0]).toContain("gte.2025-02-01");
    expect(recordCalls(first)[11]).toContain("lte.2026-01-31");

    const job = await readSyncJob(ctx, connectionId, "transactions");
    expect(job?.cursor).toMatchObject({ backfilledFrom: "2025-02-01", backfilledThrough: "2026-01-31" });
    expect(job?.nextRunAt?.getTime()).toBe(NOW.getTime() + 3_600_000);

    const second = walletStub();
    const result = await syncSourceNow(ctx, connectionId, { now: NOW, source: second.source });
    expect(recordCalls(second)).toHaveLength(1);
    expect(recordCalls(second)[0]).toContain("gte.2025-12-31");
    expect(recordCalls(second)[0]).toContain("lte.2026-01-06");
    // The same movement, recognised by its link: changed nothing, created nothing.
    expect(result.transactions).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect(await storedTransactions(ctx)).toHaveLength(1);
  });

  it("reads as many months as a re-download asks for, and never declares anything gone doing it (F2.5)", async () => {
    await syncSourceNow(ctx, connectionId, { now: NOW, source: walletStub().source });
    expect(await storedTransactions(ctx)).toHaveLength(1);

    await requestSourceBackfill(ctx, connectionId, 24);
    // Wallet no longer returns the January movement. Judged, that answer would be an empty window
    // for an account with movements in it — refused, and the whole pass failed. A re-download only
    // imports, so it goes through and the movement stays.
    const again = walletStub({ records: [] });
    const result = await syncSourceNow(ctx, connectionId, { now: NOW, source: again.source });

    expect(recordCalls(again)).toHaveLength(24);
    expect(recordCalls(again)[0]).toContain("gte.2024-02-01");
    expect(result.transactions).toMatchObject({ removed: 0 });
    expect((await runsByKind(ctx)).transactions).toMatchObject({ state: "success", error: null });
    const [movement] = await storedTransactions(ctx);
    expect(movement.removedUpstreamAt).toBeNull();

    const job = await readSyncJob(ctx, connectionId, "transactions");
    expect(job?.cursor).toMatchObject({ backfillMonths: "24", backfilledFrom: "2024-02-01" });

    // The next pass is back to the seven-day re-read, which is the one that judges.
    const hourly = walletStub();
    await syncSourceNow(ctx, connectionId, { now: NOW, source: hourly.source });
    expect(recordCalls(hourly)).toHaveLength(1);
  });

  it("re-reads three months on the first pass of a new day, so an older change in Wallet arrives", async () => {
    const december = alsoOn("2025-12-10", "wr-december");
    await syncSourceNow(ctx, connectionId, {
      now: NOW,
      source: walletStub({ records: [...JANUARY, december] }).source,
    });

    // The next morning: the December movement was moved to another category in Wallet. Seven days
    // would never see it again; the day's first pass reads November to January and does.
    const nextDay = new Date(NOW.getTime() + 24 * 3_600_000);
    const recategorised = {
      ...december,
      category: { id: "wc-unsorted", name: "Da classificare", group: null, color: null },
    };
    const deep = walletStub({ records: [...JANUARY, recategorised] });
    const result = await syncSourceNow(ctx, connectionId, { now: nextDay, source: deep.source });
    expect(recordCalls(deep)).toHaveLength(DAILY_REREAD_MONTHS);
    expect(recordCalls(deep)[0]).toContain("gte.2025-11-01");
    expect(recordCalls(deep)[2]).toContain("lte.2026-01-31");
    expect(result.transactions).toMatchObject({ updated: 1, removed: 0 });
    const moved = (await storedTransactions(ctx)).find((row) => row.note === "frutta");
    expect(moved?.categoryName).toBe("Da classificare");
    expect((await readSyncJob(ctx, connectionId, "transactions"))?.cursor).toMatchObject({
      rereadOn: "2026-01-07",
    });

    // Once a day: the next pass of the same day is the seven-day re-read again.
    const hourly = walletStub({ records: [...JANUARY, recategorised] });
    await syncSourceNow(ctx, connectionId, {
      now: new Date(nextDay.getTime() + 3_600_000),
      source: hourly.source,
    });
    expect(recordCalls(hourly)).toHaveLength(1);
  });

  it("refuses a re-download of a depth it does not offer", async () => {
    for (const months of [0, 121, 1.5]) {
      await expect(requestSourceBackfill(ctx, connectionId, months)).rejects.toThrow(RangeError);
    }
  });

  it("imports a movement on the day Wallet stamped it, in the user's own zone", async () => {
    const stub = walletStub();
    const result = await syncSourceNow(ctx, connectionId, { now: NOW, source: stub.source });
    expect(result.transactions).toMatchObject({ created: 1 });

    const [movement] = await storedTransactions(ctx);
    expect(movement.occurredAt.toISOString()).toBe("2026-01-04T23:00:00.000Z");
    expect(movement).toMatchObject({
      amountCents: -862n,
      currency: "EUR",
      type: "expense",
      state: "cleared",
      payee: "Panificio Rossi",
      note: "pane e latte",
      removedUpstreamAt: null,
    });
    expect(movement.categoryId).not.toBeNull();
  });

  it("files a category under the Wallet group it belongs to, linked as a group (F2.5)", async () => {
    await syncSourceNow(ctx, connectionId, { now: NOW, source: walletStub().source });

    const [movement] = await storedTransactions(ctx);
    const tree = await listCategories(ctx);
    // Wallet's whole list is taken on, not only the category this window's movement was filed
    // under: "Stipendio" and "Da classificare" have no movement here and are here anyway
    // (owner, 2026-09-20). "Spesa" hangs from the group Wallet gives it; the other two have none.
    expect(tree.map((one) => [one.name, one.depth])).toEqual([
      ["Casa", 0],
      ["Spesa", 1],
      ["Da classificare", 0],
      ["Stipendio", 0],
    ]);
    const [casa, spesa] = tree;
    expect(spesa.parentId).toBe(casa.id);
    expect(movement.categoryId).toBe(spesa.id);
    const groups = await resolveExternal(ctx, WALLET_PROVIDER, "category_group", ["wcg-casa"]);
    expect(groups.get("wcg-casa")).toBe(casa.id);
  });

  it("marks a movement the re-read window no longer returns, with no grace period", async () => {
    // Two movements in the seven-day window, and an answer that still carries one of them: the
    // answer proves it reached this account and this window, so its silence about the other is a
    // verdict (spec §7.2, no tolerance on top of the window itself).
    const both = [JANUARY[0], alsoOn("2026-01-04", "wr-1002")];
    await syncSourceNow(ctx, connectionId, {
      now: NOW,
      source: walletStub({ records: both }).source,
    });
    expect(await storedTransactions(ctx)).toHaveLength(2);

    const gone = walletStub({ records: [JANUARY[0]] });
    const result = await syncSourceNow(ctx, connectionId, { now: NOW, source: gone.source });
    expect(result.transactions).toMatchObject({ removed: 1 });
    expect((await runsByKind(ctx)).transactions).toMatchObject({ state: "success", error: null });

    const stored = await storedTransactions(ctx);
    expect(stored.find((row) => row.payee === "Fruttivendolo")?.removedUpstreamAt).not.toBeNull();
    expect(stored.find((row) => row.payee === "Panificio Rossi")?.removedUpstreamAt).toBeNull();

    // And it counts again the moment Wallet sends it back.
    const back = await syncSourceNow(ctx, connectionId, {
      now: NOW,
      source: walletStub({ records: both }).source,
    });
    expect(back.transactions).toMatchObject({ removed: 0 });
    expect((await storedTransactions(ctx)).every((row) => row.removedUpstreamAt === null)).toBe(true);
  });

  it("refuses an empty answer for an account that has movements in the window, and fails the pass", async () => {
    await syncSourceNow(ctx, connectionId, { now: NOW, source: walletStub().source });

    const empty = walletStub({ records: [] });
    const error = await syncSourceNow(ctx, connectionId, {
      now: NOW,
      source: empty.source,
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(RemovalRefusedError);

    // Nothing is hidden: a 200 with no rows is indistinguishable from "I did not answer you".
    const [movement] = await storedTransactions(ctx);
    expect(movement.removedUpstreamAt).toBeNull();

    // And the register says which account and which window stopped the pass, without the token.
    const runs = await runsByKind(ctx);
    expect(runs.accounts.state).toBe("success");
    expect(runs.transactions.state).toBe("failed");
    expect(runs.transactions.error).toContain("wa-general");
    expect(runs.transactions.error).toContain("2025-12-31..2026-01-06");
    expect(runs.transactions.error).not.toContain(TOKEN);
  });

  it("refuses an answer that would remove more of the window than the ceiling, and imports it anyway", async () => {
    const three = [JANUARY[0], alsoOn("2026-01-02", "wr-1002"), alsoOn("2026-01-04", "wr-1003")];
    await syncSourceNow(ctx, connectionId, {
      now: NOW,
      source: walletStub({ records: three }).source,
    });
    expect(await storedTransactions(ctx)).toHaveLength(3);

    // What a provider that caps its own page size sends: a prefix of the truth. Two of three gone
    // is over the ceiling, and the one row it did carry arrives changed.
    const truncated = [{ ...JANUARY[0], counterParty: "Panificio Bianchi" }];
    expect(2 / 3).toBeGreaterThan(MAX_WINDOW_REMOVAL_SHARE);
    const error = await syncSourceNow(ctx, connectionId, {
      now: NOW,
      source: walletStub({ records: truncated }).source,
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(RemovalRefusedError);

    const stored = await storedTransactions(ctx);
    expect(stored).toHaveLength(3);
    expect(stored.every((row) => row.removedUpstreamAt === null)).toBe(true);
    // No work is lost: the refusal gives up hiding, not importing.
    expect(stored.some((row) => row.payee === "Panificio Bianchi")).toBe(true);
    const runs = await runsByKind(ctx);
    expect(runs.transactions.state).toBe("failed");
    expect(runs.transactions.error).toContain("ceiling");
    expect(runs.transactions.counts).toMatchObject({ updated: 1 });
  });

  it("never judges the window of an account the answer no longer carries", async () => {
    await syncSourceNow(ctx, connectionId, { now: NOW, source: walletStub().source });

    // Wallet stopped returning `wa-general`: it becomes `unavailable` and is never deleted (§7.1),
    // and hiding its movements one window at a time would delete it in all but name.
    const without = walletStub({
      accounts: ACCOUNTS.filter((account) => account.id !== "wa-general"),
      records: [],
    });
    const result = await syncSourceNow(ctx, connectionId, { now: NOW, source: without.source });

    const [movement] = await storedTransactions(ctx);
    expect(movement.removedUpstreamAt).toBeNull();
    expect(result.transactions).toMatchObject({ removed: 0 });
    // Silently, with no failure: this is an ordinary pass over an account nobody asked about.
    const runs = await runsByKind(ctx);
    expect(runs.transactions).toMatchObject({ state: "success", error: null });
    expect(runs.accounts.counts).toMatchObject({ removed: 1 });

    const general = (await listAccounts(ctx, { includeArchived: true })).find(
      (account) => account.providerAccountId === "wa-general",
    );
    expect(general?.state).toBe("unavailable");
  });

  it("judges nobody's window when the accounts pass never said who was there", async () => {
    await syncSourceNow(ctx, connectionId, { now: NOW, source: walletStub().source });

    // `/accounts` fails, `/records` answers an empty window: the movements pass knows nothing about
    // who is present, so it imports and removes nothing.
    const blind = walletStub({ accountsStatus: 500, records: [] });
    const result = await syncSourceNow(ctx, connectionId, {
      now: NOW,
      source: blind.source,
    }).catch((reason: unknown) => reason);
    expect(result).toBeInstanceOf(PluginCallError);

    expect((await storedTransactions(ctx))[0].removedUpstreamAt).toBeNull();
    const runs = await runsByKind(ctx);
    expect(runs.accounts.state).toBe("failed");
    expect(runs.transactions).toMatchObject({ state: "success", error: null });
    expect(runs.transactions.counts).toMatchObject({ removed: 0 });
  });

  it("refuses a second pass on the same connection while one is running, and records nothing for it", async () => {
    const held = walletStub();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = syncSourceNow(ctx, connectionId, {
      now: NOW,
      source: servedSource(async (input, init) => {
        entered();
        await gate;
        return held.fetch(input, init);
      }),
    });
    await started;

    // The hourly job of §10.2 arriving while "Sync now" is in flight: two passes would write two
    // `transactions` rows for one Wallet movement, and orphan the first for ever.
    const second = walletStub();
    const busy = await syncSourceNow(ctx, connectionId, {
      now: NOW,
      source: second.source,
    }).catch((reason: unknown) => reason);
    expect(busy).toBeInstanceOf(SyncBusyError);
    expect(isSyncBusy(busy)).toBe(true);
    // It asked the provider nothing and opened no run: it is not an execution.
    expect(second.calls).toEqual([]);
    expect(await listRuns(ctx, { limit: 50 })).toHaveLength(1);

    release();
    await first;
    expect(await storedTransactions(ctx)).toHaveLength(1);
    expect(await listRuns(ctx, { limit: 50 })).toHaveLength(2);
  });

  it("records the failure, then revokes the connection, when the token is refused", async () => {
    const stub = walletStub({ status: 401 });
    await expect(syncSourceNow(ctx, connectionId, { now: NOW, source: stub.source })).rejects.toBeInstanceOf(
      PluginCallError,
    );

    // 401 fails at once (spec §9.1): one attempt, no retry, and no second kind attempted live.
    expect(stub.calls.filter((path) => path.startsWith("/accounts"))).toHaveLength(1);

    const runs = await runsByKind(ctx);
    expect(runs.accounts).toMatchObject({ state: "failed" });
    expect(runs.accounts.error).toBe("auth");
    expect(runs.transactions).toMatchObject({ state: "skipped", error: "token rejected" });

    const [connection] = await listConnections(ctx);
    expect(connection).toMatchObject({ state: "revoked" });
    expect(connection.lastError).toBe("auth");
    expect(connection.lastOkAt).toBeNull();
  });

  it("attempts nothing on a connection already revoked, and says so in the log", async () => {
    await syncSourceNow(ctx, connectionId, {
      now: NOW,
      source: walletStub({ status: 403 }).source,
    }).catch(() => undefined);

    const stub = walletStub();
    const result = await syncSourceNow(ctx, connectionId, { now: NOW, source: stub.source });
    // Nothing was attempted, and the result says so: the hourly job must not count this as a
    // pass, or a refused token is reported as a sync that is merely out of date (§10.4).
    expect(result).toEqual({ accounts: {}, transactions: {}, refused: "revoked" });
    expect(stub.calls).toEqual([]);

    // One from the pass that was refused (its second kind), two from this one.
    const runs = await listRuns(ctx, { limit: 50 });
    expect(runs.filter((run) => run.state === "skipped")).toHaveLength(3);
    // A skipped run proves nothing about the provider, so it moves neither the schedule nor the
    // connection's health: the movements were never once attempted, and nothing scheduled them.
    expect(await readSyncJob(ctx, connectionId, "transactions")).toBeNull();
    const [connection] = await listConnections(ctx);
    expect(connection).toMatchObject({ state: "revoked", lastOkAt: null });
  });

  it("keeps a provider it cannot reach out of `revoked`, and still tries the second kind", async () => {
    const stub = walletStub({ offline: true });
    await expect(syncSourceNow(ctx, connectionId, { now: NOW, source: stub.source })).rejects.toBeInstanceOf(
      PluginCallError,
    );

    const runs = await runsByKind(ctx);
    expect(runs.accounts.state).toBe("failed");
    expect(runs.transactions.state).toBe("failed");

    const [connection] = await listConnections(ctx);
    expect(connection.state).toBe("error");
    // Five attempts per read (spec §9.1), and the movements were attempted on their own.
    expect(stub.calls.filter((path) => path.startsWith("/accounts"))).toHaveLength(5);
    expect(stub.calls.filter((path) => path.startsWith("/categories"))).toHaveLength(5);
  });

  it("keeps one user's sync out of another's rows", async () => {
    const other = contextFor((await createTestUser()).id);
    await saveConnection(other, { provider: WALLET_PROVIDER, credentials: { token: TOKEN } });
    await syncSourceNow(ctx, connectionId, { now: NOW, source: walletStub().source });

    expect(await listAccounts(other, { includeArchived: true })).toEqual([]);
    expect(await storedTransactions(other)).toEqual([]);
    expect(await listRuns(other, { limit: 50 })).toEqual([]);
  });
});
