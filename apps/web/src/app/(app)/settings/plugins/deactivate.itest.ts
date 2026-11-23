// "Turn off" a source against a real Postgres (plugin-settings.md §3, N7.3): the numbers before and
// after are the same, nothing is left of the source's settings, turning it on again brings no
// double, an account deleted here does not come back, and a failure in the conversion changes
// nothing. Wallet is a stubbed `fetch` on `test/fixtures/wallet/`, the bank a fake plugin: no call
// leaves the test.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listAccounts } from "@domain/modules/accounts/queries";
import { restoreSourceAccounts } from "@domain/modules/accounts/service";
import { createRule } from "@domain/modules/interests/service";
import {
  allowanceOf,
  listLeaveDays,
  pendingCount,
  saveAllowance,
  saveLeaveDay,
} from "@domain/modules/timeoff/service";
import { createManualTransaction } from "@domain/modules/transactions/manual";
import { transactionIdsOfAccount } from "@domain/modules/transactions/queries";
import { pendingSends } from "@domain/modules/transactions/sending";
import { sourceCategoryCount } from "@domain/modules/transactions/source-categories";
import type { Ctx } from "@domain/platform/context";
import { addDays } from "@domain/shared/dates";
import { getDb } from "@domain/platform/db/client";
import { TREK_PROVIDER, WALLET_PROVIDER } from "@domain/platform/integrations/rules";
import { sourceSettings, sourceSkippedAccounts } from "@domain/platform/integrations/schema";
import { pluginActivations } from "@domain/platform/plugins/schema";
import {
  deletedSourceAccounts,
  deleteConnection,
  listConnections,
  recordRun,
  saveConnection,
  skippedAccounts,
} from "@domain/platform/integrations/service";
import type { SourceCalls } from "@domain/platform/integrations/wallet/calls";
import { servedSource } from "../../../../../../../test/fixtures/wallet/served-plugin";
import { chooseWalletAccounts, syncWalletNow } from "@domain/platform/integrations/wallet/sync";
import { PLUGIN_PATHS } from "@plugin-contract/calls";
import { credentialsStatus, isPluginActive } from "@domain/platform/plugins/queries";
import { refreshManifests } from "@plugin-host/service";
import { chooseAccounts, readBank, tieBack } from "@plugin-host/sync";
import "@/app/plugin-wiring";
import { numbersSnapshot } from "../../../../../../../scripts/numbers-snapshot";
import { differences } from "../../../../../../../scripts/snapshot-format";
import { closeDatabase, resetDatabase } from "../../../../../../../test/db";
import { bankAccess, BANK_NOW, fakePlugin, PLUGIN, PROVIDER } from "../../../../../../../test/bank-plugin";
import { createTestUser } from "../../../../../../../test/users";
import { deleteAccount } from "../../accounts/[id]/delete";
import { bankSink } from "../../banks/sink";
import { DeactivateError, deactivateSource, deactivationCounts, type Source, sourceOf } from "./deactivate";

/** One failure of the conversion on demand, in the middle of its transaction (criterion 3). */
const failure = vi.hoisted(() => ({ next: false }));
vi.mock("@domain/modules/transactions/source-categories", async (importOriginal) => {
  const original = await importOriginal<typeof import("@domain/modules/transactions/source-categories")>();
  return {
    ...original,
    forgetSourceCategories: async (...args: Parameters<typeof original.forgetSourceCategories>) => {
      if (failure.next) throw new Error("the conversion failed");
      return original.forgetSourceCategories(...args);
    },
  };
});

function contextFor(userId: string): Ctx {
  return {
    userId,
    role: "user",
    locale: "it",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
}

let ctx: Ctx;

beforeEach(async () => {
  await resetDatabase();
  failure.next = false;
  ctx = contextFor((await createTestUser()).id);
});
afterAll(closeDatabase);

const NOW = new Date("2026-01-06T08:07:00Z");
const later = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);

/** The numbers of the person, as the pages read them, with no name of the source in them. */
const numbers = () => numbersSnapshot(ctx, later(48));

/** A last reading that answers at once: what the real one does is the pass's own test. */
const reads: string[] = [];
const deps = { finalRead: async (connectionId: string) => void reads.push(connectionId) };

async function codeOf(work: Promise<unknown>): Promise<string> {
  const error = await work.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(DeactivateError);
  return (error as DeactivateError).code;
}

async function movementCount(): Promise<number> {
  const accounts = await listAccounts(ctx, { includeArchived: true });
  return (await Promise.all(accounts.map((one) => transactionIdsOfAccount(ctx, one.id)))).flat().length;
}

// ——— Wallet ——————————————————————————————————————————————————————————————————————————————————

const FIXTURES = join(process.cwd(), "test/fixtures/wallet");
const fixture = (name: string): { [key: string]: unknown } =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
const CATEGORIES = fixture("categories.json");
type WireRecord = { recordDate: string; [key: string]: unknown };
const ACCOUNTS = (fixture("accounts.json").accounts as { id: string }[]).filter((one) =>
  ["wa-general", "wa-cash", "wa-savings"].includes(one.id),
);
const JANUARY = fixture("records-january-first-half.json").records as WireRecord[];

/** Wallet on the fixtures, read through the plugin served in-process. */
function walletStub(): SourceCalls {
  return servedSource(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/accounts")) return Response.json({ accounts: ACCOUNTS });
    if (url.pathname.endsWith("/categories")) return Response.json(CATEGORIES);
    const bounds = url.searchParams.getAll("recordDate");
    const from = bounds.find((one) => one.startsWith("gte."))?.slice(4) ?? "";
    const to = bounds.find((one) => one.startsWith("lte."))?.slice(4) ?? "";
    return Response.json({
      records: JANUARY.filter((row) => row.recordDate >= from && row.recordDate <= to),
      appliedRecordDateFilters: [`gte.${from}T00:00:00.000Z`, `lt.${addDays(to, 1)}T00:00:00.000Z`],
    });
  });
}

const wallet = (): Source => ({ provider: WALLET_PROVIDER, pluginId: "wallet", days: false });
const walletAccounts = () => listAccounts(ctx, { includeArchived: true });

/** Wallet read once, with one account left out, one interest rule (none publishes since R5c) and one movement waiting. */
async function walletInUse() {
  const connection = await saveConnection(ctx, { provider: WALLET_PROVIDER, credentials: { token: "t" } });
  const options = { now: NOW, source: walletStub() };
  await chooseWalletAccounts(ctx, connection.id, ["wa-general", "wa-cash"], { source: walletStub() });
  await syncWalletNow(ctx, connection.id, options);
  const general = (await listAccounts(ctx)).find((one) => one.providerAccountId === "wa-general")!;
  await createRule(ctx, {
    accountId: general.id,
    taxRate: "0",
    dayBasis: "365",
    settlement: "monthly",
    validFrom: "2026-01-01",
    validTo: null,
    payeeMatch: "interessi",
    mode: "analyze_only",
    tiers: [{ upToCents: null, annualRate: "0.0365" }],
  });
  await createManualTransaction(
    ctx,
    {
      kind: "expense",
      amountCents: 450n,
      on: "2026-01-05",
      accountId: general.id,
      categoryId: null,
      payee: "Bar",
      note: "",
    },
    undefined,
    { toSend: true },
  );
  return { connection, general, options };
}

describe("Turn off Wallet", () => {
  it("counts what the dialog says, converts with the same numbers, and leaves nothing of Wallet", async () => {
    const { general } = await walletInUse();
    const cash = (await listAccounts(ctx)).find((one) => one.providerAccountId === "wa-cash")!;
    // Deleted here: a memory of the core, which turning off keeps (§3.2, row 21).
    await deleteAccount(ctx, cash.id);
    const before = await numbers();
    const movements = await movementCount();

    const counts = await deactivationCounts(ctx, wallet());
    expect(counts).toMatchObject({ accounts: 1, rules: 0, unsent: 1, pendingDays: 0 });
    expect(counts.categories).toBeGreaterThan(0);

    reads.length = 0;
    expect(await deactivateSource(ctx, wallet(), deps, later(1))).toEqual({ accounts: 1 });
    expect(reads).toHaveLength(1);

    // Criterion 1: the same numbers.
    expect(differences(before, await numbers())).toEqual([]);
    expect(await movementCount()).toBe(movements);

    const [account] = await walletAccounts();
    expect(account).toMatchObject({
      id: general.id,
      origin: "manual",
      provider: null,
      providerAccountId: null,
    });
    expect(await listConnections(ctx)).toEqual([]);
    // A plugin since R5c: turning the source off turns the plugin off for the person.
    const activations = await getDb().select().from(pluginActivations);
    expect(activations.map((row) => [row.pluginId, row.active])).toEqual([["wallet", false]]);
    expect(await sourceCategoryCount(ctx, WALLET_PROVIDER)).toBe(0);
    expect(await pendingSends(ctx, [general.id], 10)).toEqual([]);
    expect(await deactivationCounts(ctx, wallet())).toEqual({
      accounts: 0,
      categories: 0,
      rules: 0,
      unsent: 0,
      pendingDays: 0,
    });
    const skipped = await getDb().select().from(sourceSkippedAccounts);
    expect(skipped.map((row) => [row.externalId, row.reason, row.name])).toEqual([
      ["wa-cash", "deleted", cash.name],
    ]);
    expect(await getDb().select().from(sourceSettings)).toEqual([]);
  });

  it("turned on again: the same accounts and movements, no double; a deleted account does not come back", async () => {
    const { general } = await walletInUse();
    const cash = (await listAccounts(ctx)).find((one) => one.providerAccountId === "wa-cash")!;
    await deleteAccount(ctx, cash.id);
    await deactivateSource(ctx, wallet(), deps, later(1));
    // A movement written by hand while Wallet was off stays one.
    await createManualTransaction(ctx, {
      kind: "expense",
      amountCents: 120n,
      on: "2026-01-06",
      accountId: general.id,
      categoryId: null,
      payee: "Edicola",
      note: "",
    });
    const movements = await movementCount();

    const again = await saveConnection(ctx, { provider: WALLET_PROVIDER, credentials: { token: "t2" } });
    expect(await restoreSourceAccounts(ctx, WALLET_PROVIDER)).toBe(1);
    // The accounts deleted here stay out; the ones left out are asked again (§3.4).
    expect(await skippedAccounts(ctx, again.id)).toEqual(new Set(["wa-cash"]));
    await syncWalletNow(ctx, again.id, { now: later(2), source: walletStub() });

    const accounts = await walletAccounts();
    expect(accounts.map((one) => [one.id, one.provider, one.providerAccountId, one.origin]).sort()).toEqual(
      [
        [general.id, WALLET_PROVIDER, "wa-general", "synced"],
        // Left out before turning off: the choice went with it, so the source brings it.
        [expect.any(String), WALLET_PROVIDER, "wa-savings", "synced"],
      ].sort(),
    );
    expect(accounts.some((one) => one.providerAccountId === "wa-cash")).toBe(false);
    const generalMovements = await transactionIdsOfAccount(ctx, general.id);
    const savings = accounts.find((one) => one.providerAccountId === "wa-savings")!;
    expect(generalMovements.length + (await transactionIdsOfAccount(ctx, savings.id)).length).toBe(movements);
    // Restoring twice ties nothing more.
    expect(await restoreSourceAccounts(ctx, WALLET_PROVIDER)).toBe(0);
  });

  it("a failure in the conversion changes nothing: Wallet stays on (criterion 3)", async () => {
    await walletInUse();
    const before = await numbers();
    const accounts = await walletAccounts();
    failure.next = true;
    await expect(deactivateSource(ctx, wallet(), deps, later(1))).rejects.toThrow("the conversion failed");
    expect(await walletAccounts()).toEqual(accounts);
    expect(await listConnections(ctx)).toHaveLength(1);
    expect(await deactivationCounts(ctx, wallet())).toMatchObject({ accounts: 2, rules: 0, unsent: 1 });
    expect(differences(before, await numbers())).toEqual([]);
  });

  it("a last reading still running after its time stops the deactivation before anything changes", async () => {
    await walletInUse();
    const slow = { finalRead: () => new Promise<void>(() => undefined), finalReadMs: 20 };
    expect(await codeOf(deactivateSource(ctx, wallet(), slow, later(1)))).toBe("failed");
    expect(await listConnections(ctx)).toHaveLength(1);
  });

  it("a reading still running stops it before anything changes (it would write the accounts again)", async () => {
    const { connection } = await walletInUse();
    await recordRun(ctx, { connectionId: connection.id, kind: "transactions" });
    expect(await codeOf(deactivateSource(ctx, wallet(), deps, new Date()))).toBe("failed");
    expect(await listConnections(ctx)).toHaveLength(1);
    expect((await deactivationCounts(ctx, wallet())).accounts).toBe(2);
  });

  it("a last reading that fails does not stop it (§3.2, step 1)", async () => {
    await walletInUse();
    const failing = { finalRead: async () => Promise.reject(new Error("down")) };
    expect(await deactivateSource(ctx, wallet(), failing, later(1))).toEqual({ accounts: 2 });
  });

  it("disconnected first: the accounts are converted all the same", async () => {
    const { connection, general } = await walletInUse();
    await deleteConnection(ctx, connection.id);
    reads.length = 0;
    expect(await deactivateSource(ctx, wallet(), deps, later(1))).toEqual({ accounts: 2 });
    expect(reads).toEqual([]);
    expect((await walletAccounts()).find((one) => one.id === general.id)?.origin).toBe("manual");
    // "Disconnect" kept the settings for later; turning off deletes them.
    expect(await getDb().select().from(sourceSettings)).toEqual([]);
  });
});

describe("the sources a page may turn off", () => {
  it("are the plugins read by the core with a page, on or not, and the plugins the person has on", async () => {
    // By the page's slug; Wallet and Trek are plugins since R5c, still read by the core.
    expect(await sourceOf(ctx, "wallet")).toEqual(wallet());
    expect(await sourceOf(ctx, "trek")).toEqual({
      provider: TREK_PROVIDER,
      pluginId: "trek",
      days: true,
    });
    expect(await sourceOf(ctx, WALLET_PROVIDER)).toBeNull();
    expect(await sourceOf(ctx, "etoro")).toBeNull();
    expect(await sourceOf(ctx, "enablebanking")).toBeNull();
    expect(await sourceOf(ctx, "../x")).toBeNull();
  });
});

// ——— Trek ————————————————————————————————————————————————————————————————————————————————————

describe("Turn off Trek", () => {
  it("keeps every day and the residual; the changes waiting are not sent", async () => {
    await saveAllowance(ctx, 2026, { vacationDays: 26 });
    await saveConnection(ctx, {
      provider: TREK_PROVIDER,
      credentials: { baseUrl: "https://trek.test", clientId: "c", clientSecret: "s" },
    });
    await saveLeaveDay(ctx, { from: "2026-01-12", to: "2026-01-13", kind: "vacation" });
    const pending = await pendingCount(ctx);
    const window = { from: "2026-01-01", to: "2026-12-31" } as const;
    const days = await listLeaveDays(ctx, window);
    const before = await numbers();
    const allowance = await allowanceOf(ctx, 2026);

    const trek: Source = { provider: TREK_PROVIDER, pluginId: "trek", days: true };
    expect((await deactivationCounts(ctx, trek)).pendingDays).toBe(pending);
    await deactivateSource(ctx, trek, deps, later(1));

    expect(await pendingCount(ctx)).toBe(0);
    expect((await listLeaveDays(ctx, window)).map((one) => [one.on, one.kind, one.fraction])).toEqual(
      days.map((one) => [one.on, one.kind, one.fraction]),
    );
    expect(await allowanceOf(ctx, 2026)).toEqual(allowance);
    expect(differences(before, await numbers())).toEqual([]);
    expect(await listConnections(ctx)).toEqual([]);
  });
});

// ——— A plugin: a bank ————————————————————————————————————————————————————————————————————————

describe("Turn off a bank's plugin", () => {
  it("closes the accesses, forgets the key, keeps the numbers, and ties the account back when turned on again", async () => {
    const plugin = fakePlugin();
    await refreshManifests(BANK_NOW, plugin.deps);
    const connectionId = await bankAccess(ctx, plugin);
    const target = { pluginId: PLUGIN, connectionId };
    await chooseAccounts(
      ctx,
      {
        ...target,
        decisions: [
          {
            providerAccountId: "hash-1",
            currency: "EUR",
            target: { kind: "new", name: "Zeta", type: "checking" },
          },
        ],
      },
      bankSink,
      BANK_NOW,
    );
    await readBank(ctx, { ...target, presence: null }, bankSink, BANK_NOW, plugin.deps);
    const [account] = await listAccounts(ctx);
    const movements = await movementCount();
    expect(movements).toBe(1);
    const before = numbersSnapshot(ctx, new Date("2026-11-20T10:00:00Z"));

    const source = await sourceOf(ctx, PLUGIN);
    expect(source).toEqual({ provider: PROVIDER, pluginId: PLUGIN, days: false });
    expect(await deactivateSource(ctx, source!, { ...deps, plugin: plugin.deps }, BANK_NOW)).toEqual({
      accounts: 1,
    });

    // Criterion 8: the access is closed at the bank, after the conversion.
    expect(plugin.calls.filter((call) => call.path === PLUGIN_PATHS.authRevoke)).toHaveLength(1);
    expect(differences(await before, await numbersSnapshot(ctx, new Date("2026-11-20T10:00:00Z")))).toEqual(
      [],
    );
    expect(await isPluginActive(ctx, PLUGIN)).toBe(false);
    expect((await credentialsStatus(ctx, PLUGIN)).saved).toBe(false);
    expect(await listConnections(ctx)).toEqual([]);
    expect((await listAccounts(ctx))[0]).toMatchObject({ id: account.id, origin: "manual", provider: null });
    // A plugin that is off has no page, and so nothing to turn off.
    expect(await sourceOf(ctx, PLUGIN)).toBeNull();

    // Turned on again: the key again, the bank again, and the same account comes back (§3.4).
    const again = await bankAccess(ctx, plugin);
    // Only the accounts the new access exposes come back: another bank's stay kept by hand.
    expect(await restoreSourceAccounts(ctx, PROVIDER, new Set(["another-bank"]))).toBe(0);
    expect(await restoreSourceAccounts(ctx, PROVIDER, new Set(["hash-1"]))).toBe(1);
    expect(await tieBack(ctx, { pluginId: PLUGIN, connectionId: again }, bankSink, BANK_NOW)).toBe(true);
    await readBank(
      ctx,
      { pluginId: PLUGIN, connectionId: again, presence: null },
      bankSink,
      BANK_NOW,
      plugin.deps,
    );
    const accounts = await listAccounts(ctx, { includeArchived: true });
    expect(accounts.map((one) => [one.id, one.origin, one.provider])).toEqual([
      [account.id, "synced", PROVIDER],
    ]);
    expect(await movementCount()).toBe(movements);
  });

  it("an account of the bank deleted here is listed for Bring back and does not come back by itself", async () => {
    const plugin = fakePlugin();
    await refreshManifests(BANK_NOW, plugin.deps);
    const connectionId = await bankAccess(ctx, plugin);
    await chooseAccounts(
      ctx,
      {
        pluginId: PLUGIN,
        connectionId,
        decisions: [
          {
            providerAccountId: "hash-1",
            currency: "EUR",
            target: { kind: "new", name: "Zeta", type: "checking" },
          },
        ],
      },
      bankSink,
      BANK_NOW,
    );
    const [account] = await listAccounts(ctx);
    await deactivateSource(ctx, (await sourceOf(ctx, PLUGIN))!, { ...deps, plugin: plugin.deps }, BANK_NOW);
    // Deleted while kept by hand: the source's id it kept is remembered all the same (§4.3).
    await deleteAccount(ctx, account.id);
    expect(await deletedSourceAccounts(ctx, PROVIDER)).toEqual([{ externalId: "hash-1", name: "Zeta" }]);
    await bankAccess(ctx, plugin);
    expect(await restoreSourceAccounts(ctx, PROVIDER)).toBe(0);
    expect(await listAccounts(ctx, { includeArchived: true })).toEqual([]);
  });
});
