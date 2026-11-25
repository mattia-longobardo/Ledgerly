// The new section of the plugins, its server part (decision H56): the five states of a plugin in
// `GET /plugins`, the way out of «needs cleanup» (D1 = A), the refusals of «Deactivate», «Activate»
// and «Connect» with what the client needs to say them, and where an account stands with its source.
// The bank is a fake plugin (`test/bank-plugin.ts`), Wallet the plugin served in-process: no call
// leaves the test.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNTS, SETTINGS } from "@ledgerly/api-contract";
import type { Ctx } from "@domain/platform/context";
import { getDb } from "@domain/platform/db/client";
import { listAccounts } from "@domain/modules/accounts/queries";
import { deleteConnection, recordRun } from "@domain/platform/integrations/service";
import { syncRuns } from "@domain/platform/integrations/schema";
import { isPluginActive } from "@domain/platform/plugins/queries";
import { PluginActionError, refreshManifests, setPluginActive } from "@plugin-host/service";
import { chooseAccounts, readBank } from "@plugin-host/sync";
import { PLUGIN_PATHS } from "@plugin-contract/calls";
import "@/app/plugin-wiring";
import { numbersSnapshot } from "../../../../../../../scripts/numbers-snapshot";
import { differences } from "../../../../../../../scripts/snapshot-format";
import { bankAccess, BANK_NOW, fakePlugin, PLUGIN, PROVIDER } from "../../../../../../../test/bank-plugin";
import { closeDatabase, resetDatabase } from "../../../../../../../test/db";
import { contextFor } from "../../../../../../../test/fixtures";
import { WALLET_PROVIDER } from "../../../../../../../test/fixtures/providers";
import { createTestUser } from "../../../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const { bankSink } = await import("../../banks/sink");
const { DeactivateError, deactivateSource, sourceToTurnOff } = await import("./deactivate");

let ctx: Ctx;

beforeEach(async () => {
  await resetDatabase();
  ctx = contextFor((await createTestUser()).id);
});

afterAll(closeDatabase);

async function send(method: string, path: string, body?: unknown) {
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

/** The bank's plugin as `GET /plugins` answers it. */
async function bank() {
  const { body } = await send("GET", "/plugins");
  const plugins = SETTINGS.sources.listPlugins.response.parse(body).plugins;
  return plugins.find((one) => one.id === PLUGIN)!;
}

/** A bank connected, its one account chosen as a new account and read once. */
async function bankInUse(plugin: ReturnType<typeof fakePlugin>) {
  const connectionId = await bankAccess(ctx, plugin);
  const target = { pluginId: PLUGIN, connectionId };
  const decisions = [
    {
      providerAccountId: "hash-1",
      currency: "EUR",
      target: { kind: "new" as const, name: "Zeta", type: "checking" },
    },
  ];
  await chooseAccounts(ctx, { ...target, decisions }, bankSink, BANK_NOW);
  await readBank(ctx, { ...target, presence: null }, bankSink, BANK_NOW, plugin.deps);
  return connectionId;
}

const NOTHING = { accounts: 0, categories: 0, pendingTx: 0, pendingDays: 0 };
const noRead = { finalRead: async () => undefined };

describe("the five states of a plugin in GET /plugins (H56)", () => {
  it("is not active, then not connected, connected, disconnected; needs cleanup when off with its data", async () => {
    const plugin = fakePlugin();
    await refreshManifests(BANK_NOW, plugin.deps);
    expect(await bank()).toMatchObject({
      pluginState: "not_active",
      health: null,
      deactivatedAt: null,
      leftovers: NOTHING,
      capabilities: { reads: ["accounts", "transactions"], writes: [] },
    });

    await setPluginActive(ctx, { pluginId: PLUGIN, active: true }, BANK_NOW);
    expect(await bank()).toMatchObject({ pluginState: "not_connected", health: null });

    const connectionId = await bankAccess(ctx, plugin);
    // Accounts not chosen yet: the person has something to do.
    expect(await bank()).toMatchObject({ pluginState: "connected", health: "action_needed" });

    const target = { pluginId: PLUGIN, connectionId };
    const decisions = [
      {
        providerAccountId: "hash-1",
        currency: "EUR",
        target: { kind: "new" as const, name: "Zeta", type: "checking" },
      },
    ];
    await chooseAccounts(ctx, { ...target, decisions }, bankSink, BANK_NOW);
    await deleteConnection(ctx, connectionId);
    expect(await bank()).toMatchObject({
      pluginState: "disconnected",
      health: null,
      leftovers: { ...NOTHING, accounts: 1 },
    });

    const off = new Date("2026-11-20T09:00:00Z");
    await setPluginActive(ctx, { pluginId: PLUGIN, active: false }, off);
    expect(await bank()).toMatchObject({
      pluginState: "needs_cleanup",
      health: null,
      deactivatedAt: off.toISOString(),
      leftovers: { ...NOTHING, accounts: 1 },
    });
  });
});

describe("«Deactivate» out of «needs cleanup» (H56, D1 = A)", () => {
  it("converts with the same balances, and the plugin is not active with nothing left", async () => {
    const plugin = fakePlugin();
    await refreshManifests(BANK_NOW, plugin.deps);
    await bankInUse(plugin);
    const off = new Date("2026-11-20T09:00:00Z");
    await setPluginActive(ctx, { pluginId: PLUGIN, active: false }, off);
    expect((await bank()).pluginState).toBe("needs_cleanup");

    // The account: stopped since the plugin went off.
    const [account] = await listAccounts(ctx);
    const row = () =>
      send("GET", "/accounts").then(
        ({ body }) => ACCOUNTS.accounts.listAccounts.response.parse(body).accounts[0],
      );
    expect(await row()).toMatchObject({
      id: account.id,
      sourceState: "stopped",
      stoppedSince: off.toISOString(),
    });

    // The dialog's preview, for a plugin that is off.
    const preview = await send("GET", `/sources/${PLUGIN}/deactivation`);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ accounts: 1, movements: 1, credentials: true });

    const at = new Date("2026-11-21T10:00:00Z");
    const before = await numbersSnapshot(ctx, at);
    const source = await sourceToTurnOff(ctx, PLUGIN);
    expect(source).toEqual({ provider: PROVIDER, pluginId: PLUGIN, days: false, bank: true });
    expect(await deactivateSource(ctx, source!, { ...noRead, plugin: plugin.deps })).toEqual({ accounts: 1 });

    expect(differences(before, await numbersSnapshot(ctx, at))).toEqual([]);
    expect(await bank()).toMatchObject({ pluginState: "not_active", leftovers: NOTHING });
    expect(await isPluginActive(ctx, PLUGIN)).toBe(false);
    // The account: kept by hand, and it says where it came from.
    const detail = await send("GET", `/accounts/${account.id}`);
    expect(ACCOUNTS.accounts.getAccount.response.parse(detail.body)).toMatchObject({
      origin: "manual",
      sourceState: "former",
      formerSource: PROVIDER,
    });
  });
});

describe("the refusals with their causes (H56)", () => {
  it("refuses «Deactivate» of a plugin that is off with nothing left: not_active", async () => {
    await refreshManifests(BANK_NOW, fakePlugin().deps);
    expect(await send("POST", `/sources/${PLUGIN}/deactivate`)).toEqual({
      status: 409,
      body: { error: "conflict", reason: "not_active" },
    });
  });

  it("refuses «Deactivate» during a reading, with since when: reading_in_progress", async () => {
    const plugin = fakePlugin();
    await refreshManifests(BANK_NOW, plugin.deps);
    const connectionId = await bankAccess(ctx, plugin);
    const run = await recordRun(ctx, { connectionId, kind: "transactions" });
    const answer = await send("POST", `/sources/${PLUGIN}/deactivate`, { stopReading: true });
    expect(answer).toEqual({
      status: 409,
      body: { error: "conflict", reason: "reading_in_progress", startedAt: run.startedAt.toISOString() },
    });
    // Nothing changed.
    expect(await isPluginActive(ctx, PLUGIN)).toBe(true);
  });

  it("stops a reading older than 15 minutes when asked, then deactivates (D3 = A)", async () => {
    const plugin = fakePlugin();
    await refreshManifests(BANK_NOW, plugin.deps);
    const connectionId = await bankAccess(ctx, plugin);
    const now = new Date();
    await recordRun(ctx, { connectionId, kind: "transactions" });
    await getDb()
      .update(syncRuns)
      .set({ startedAt: new Date(now.getTime() - 20 * 60_000) });
    const source = (await sourceToTurnOff(ctx, PLUGIN))!;
    const deps = { ...noRead, plugin: plugin.deps };
    // Without asking: refused, the reading named.
    const refused = await deactivateSource(ctx, source, deps, now).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(DeactivateError);
    expect((refused as InstanceType<typeof DeactivateError>).refusal?.reason).toBe("reading_in_progress");
    // Asked: the reading stops, the plugin goes off.
    expect(await deactivateSource(ctx, source, { ...deps, stopReading: true }, now)).toEqual({ accounts: 0 });
    expect(await isPluginActive(ctx, PLUGIN)).toBe(false);
  });

  it("keeps a reading younger than 15 minutes even when asked to stop it", async () => {
    const plugin = fakePlugin();
    await refreshManifests(BANK_NOW, plugin.deps);
    const connectionId = await bankAccess(ctx, plugin);
    await recordRun(ctx, { connectionId, kind: "transactions" });
    const source = (await sourceToTurnOff(ctx, PLUGIN))!;
    const refused = await deactivateSource(ctx, source, {
      ...noRead,
      plugin: plugin.deps,
      stopReading: true,
    }).catch((error: unknown) => error);
    expect((refused as InstanceType<typeof DeactivateError>).refusal?.reason).toBe("reading_in_progress");
    expect(await isPluginActive(ctx, PLUGIN)).toBe(true);
  });

  it("refuses «Deactivate» when the plugin does not answer, and deactivates all the same when asked: plugin_down", async () => {
    const plugin = fakePlugin();
    await refreshManifests(BANK_NOW, plugin.deps);
    await bankAccess(ctx, plugin);
    const down = {
      fetchFn: async (input: string | URL | Request, init?: RequestInit) =>
        new URL(String(input)).pathname === PLUGIN_PATHS.manifest
          ? new Response("down", { status: 503 })
          : plugin.deps.fetchFn(input, init),
    };
    const source = (await sourceToTurnOff(ctx, PLUGIN))!;
    const refused = await deactivateSource(ctx, source, { ...noRead, plugin: down }).catch(
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(PluginActionError);
    expect((refused as PluginActionError).code).toBe("plugin_down");
    expect(await isPluginActive(ctx, PLUGIN)).toBe(true);
    expect(await deactivateSource(ctx, source, { ...noRead, plugin: down, force: true })).toEqual({
      accounts: 0,
    });
    expect(await isPluginActive(ctx, PLUGIN)).toBe(false);
  });

  it("refuses «Activate» of a plugin the instance does not have: 404, the not_available of the client", async () => {
    expect(await send("PATCH", "/plugins/nothing", { active: true })).toEqual({
      status: 404,
      body: { error: "not_found" },
    });
  });

  it("refuses «Connect» of a plugin that is not on, and does not turn it on: not_active", async () => {
    const answer = await send("POST", "/connections", {
      provider: WALLET_PROVIDER,
      credentials: { token: "t" },
    });
    expect(answer).toEqual({ status: 409, body: { error: "conflict", reason: "not_active" } });
    expect(await isPluginActive(ctx, "wallet")).toBe(false);
  });
});
