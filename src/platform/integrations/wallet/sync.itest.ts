// The Wallet sync engine against a real Postgres (spec §11). Wallet itself is a stubbed `fetch`
// answering with the fixtures in `tests/fixtures/wallet/`: there is no token to call the real API
// with, and the real `client.ts` still does the parsing, the paging and the retries.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { listAccounts, listBalanceEntries } from "@/modules/accounts/queries";
import { listTransactions } from "@/modules/transactions/queries";
import type { Ctx } from "@/platform/context";
import { closeDatabase, resetDatabase } from "../../../../test/db";
import { createTestUser } from "../../../../test/users";
import { WALLET_PROVIDER } from "../rules";
import { listConnections, listRuns, readSyncJob, saveConnection } from "../service";
import { WalletError, type WalletClientOptions } from "./client";
import { syncWalletNow } from "./sync";

const FIXTURES = join(process.cwd(), "tests/fixtures/wallet");
const fixture = (name: string): { [key: string]: unknown } =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

const ACCOUNTS = fixture("accounts.json");
const CATEGORIES = fixture("categories.json");
/** One expense, 2026-01-05, on `wa-general`, category `wc-groceries`. */
const JANUARY = fixture("records-january-first-half.json").records as { recordDate: string }[];

const BASE = "https://wallet.test/api";
/** A Tuesday 09:07 in Rome (spec §10.2's minute), inside the seven days after the fixture's date. */
const NOW = new Date("2026-01-06T08:07:00Z");
const TOKEN = "wallet-token-8ac31f";

interface Stub {
  /** Every path the client asked for, in order. */
  calls: string[];
  options: WalletClientOptions;
}

/**
 * Wallet, as far as the client can tell. `records` is filtered by the `recordDate` bounds the
 * client sends, so the window logic is exercised rather than assumed; `status` and `offline` stand
 * in for a refused token and an unreachable provider.
 */
function walletStub(
  options: { records?: { recordDate: string }[]; status?: number; offline?: boolean } = {},
): Stub {
  const records = options.records ?? JANUARY;
  const calls: string[] = [];
  const stub: WalletClientOptions = {
    baseUrl: BASE,
    // The retry policy is the client's and is tested there; here it must not cost 30 seconds.
    sleep: async () => undefined,
    jitter: () => 0,
    fetch: async (input) => {
      const url = new URL(String(input));
      calls.push(`${url.pathname}${url.search}`);
      if (options.offline) throw new TypeError("fetch failed");
      if (options.status) return new Response("{}", { status: options.status });
      if (url.pathname.endsWith("/accounts")) return Response.json(ACCOUNTS);
      if (url.pathname.endsWith("/categories")) return Response.json(CATEGORIES);
      const bounds = url.searchParams.getAll("recordDate");
      const from = bounds.find((one) => one.startsWith("gte."))?.slice(4) ?? "";
      const to = bounds.find((one) => one.startsWith("lte."))?.slice(4) ?? "";
      const inWindow = records.filter((row) => row.recordDate >= from && row.recordDate <= to);
      return Response.json({ records: inWindow });
    },
  };
  return { calls, options: stub };
}

const recordCalls = (stub: Stub): string[] => stub.calls.filter((path) => path.startsWith("/api/records"));

function contextFor(userId: string): Ctx {
  return { userId, role: "user", locale: "en", timeZone: "Europe/Rome", numberFormat: "it-IT" };
}

/** Every movement, hidden and disappeared ones included: this is a sync's own bookkeeping. */
async function storedTransactions(ctx: Ctx) {
  return listTransactions(ctx, { includeHidden: true, sort: "date", direction: "asc" });
}

async function runsByKind(ctx: Ctx) {
  const runs = await listRuns(ctx, { limit: 50 });
  return Object.fromEntries(runs.map((run) => [run.kind, run]));
}

let ctx: Ctx;
let connectionId: string;

describe("syncWalletNow", () => {
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
    const result = await syncWalletNow(ctx, connectionId, { now: NOW, clientOptions: stub.options });

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

  it("reads twelve monthly windows on the first link and only the last seven days afterwards", async () => {
    const first = walletStub();
    await syncWalletNow(ctx, connectionId, { now: NOW, clientOptions: first.options });

    expect(recordCalls(first)).toHaveLength(12);
    expect(recordCalls(first)[0]).toContain("gte.2025-02-01");
    expect(recordCalls(first)[11]).toContain("lte.2026-01-31");

    const job = await readSyncJob(ctx, connectionId, "transactions");
    expect(job?.cursor).toMatchObject({ backfilledFrom: "2025-02-01", backfilledThrough: "2026-01-31" });
    expect(job?.nextRunAt?.getTime()).toBe(NOW.getTime() + 3_600_000);

    const second = walletStub();
    const result = await syncWalletNow(ctx, connectionId, { now: NOW, clientOptions: second.options });
    expect(recordCalls(second)).toHaveLength(1);
    expect(recordCalls(second)[0]).toContain("gte.2025-12-31");
    expect(recordCalls(second)[0]).toContain("lte.2026-01-06");
    // The same movement, recognised by its link: changed nothing, created nothing.
    expect(result.transactions).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect(await storedTransactions(ctx)).toHaveLength(1);
  });

  it("imports a movement on the day Wallet stamped it, in the user's own zone", async () => {
    const stub = walletStub();
    const result = await syncWalletNow(ctx, connectionId, { now: NOW, clientOptions: stub.options });
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

  it("marks a movement the re-read window no longer returns, with no grace period", async () => {
    await syncWalletNow(ctx, connectionId, { now: NOW, clientOptions: walletStub().options });

    const gone = walletStub({ records: [] });
    const result = await syncWalletNow(ctx, connectionId, { now: NOW, clientOptions: gone.options });
    expect(result.transactions).toMatchObject({ removed: 1 });

    const [movement] = await storedTransactions(ctx);
    expect(movement.removedUpstreamAt).not.toBeNull();

    // And it counts again the moment Wallet sends it back.
    const back = await syncWalletNow(ctx, connectionId, { now: NOW, clientOptions: walletStub().options });
    expect(back.transactions).toMatchObject({ removed: 0 });
    expect((await storedTransactions(ctx))[0].removedUpstreamAt).toBeNull();
  });

  it("records the failure, then revokes the connection, when the token is refused", async () => {
    const stub = walletStub({ status: 401 });
    await expect(
      syncWalletNow(ctx, connectionId, { now: NOW, clientOptions: stub.options }),
    ).rejects.toBeInstanceOf(WalletError);

    // 401 fails at once (spec §9.1): one attempt, no retry, and no second kind attempted live.
    expect(stub.calls.filter((path) => path.startsWith("/api/accounts"))).toHaveLength(1);

    const runs = await runsByKind(ctx);
    expect(runs.accounts).toMatchObject({ state: "failed" });
    expect(runs.accounts.error).toContain("401");
    expect(runs.transactions).toMatchObject({ state: "skipped", error: "token rejected" });

    const [connection] = await listConnections(ctx);
    expect(connection).toMatchObject({ state: "revoked" });
    expect(connection.lastError).toContain("401");
    expect(connection.lastOkAt).toBeNull();
  });

  it("attempts nothing on a connection already revoked, and says so in the log", async () => {
    await syncWalletNow(ctx, connectionId, {
      now: NOW,
      clientOptions: walletStub({ status: 403 }).options,
    }).catch(() => undefined);

    const stub = walletStub();
    const result = await syncWalletNow(ctx, connectionId, { now: NOW, clientOptions: stub.options });
    expect(result).toEqual({ accounts: {}, transactions: {} });
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
    await expect(
      syncWalletNow(ctx, connectionId, { now: NOW, clientOptions: stub.options }),
    ).rejects.toBeInstanceOf(WalletError);

    const runs = await runsByKind(ctx);
    expect(runs.accounts.state).toBe("failed");
    expect(runs.transactions.state).toBe("failed");

    const [connection] = await listConnections(ctx);
    expect(connection.state).toBe("error");
    // Five attempts per read (spec §9.1), and the movements were attempted on their own.
    expect(stub.calls.filter((path) => path.startsWith("/api/accounts"))).toHaveLength(5);
    expect(stub.calls.filter((path) => path.startsWith("/api/categories"))).toHaveLength(5);
  });

  it("keeps one user's sync out of another's rows", async () => {
    const other = contextFor((await createTestUser()).id);
    await saveConnection(other, { provider: WALLET_PROVIDER, credentials: { token: TOKEN } });
    await syncWalletNow(ctx, connectionId, { now: NOW, clientOptions: walletStub().options });

    expect(await listAccounts(other, { includeArchived: true })).toEqual([]);
    expect(await storedTransactions(other)).toEqual([]);
    expect(await listRuns(other, { limit: 50 })).toEqual([]);
  });
});
