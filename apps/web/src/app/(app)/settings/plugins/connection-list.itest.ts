// `GET /api/v1/connections` says the state of each row by the same rule as the page (decision of
// 19/11/2026 on the client's request): `status` is what the page's `statusOf` gives, state by state.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { getDb } from "@domain/platform/db/client";
import { ETORO_PROVIDER } from "@domain/platform/integrations/rules";
import { BACKFILL_MONTHS, FIRST_LINK_MONTHS } from "@plugin-host/movements/depth";
import { integrationConnections } from "@domain/platform/integrations/schema";
import {
  listConnections,
  markConnection,
  recordRun,
  saveConnection,
  saveSyncJob,
} from "@domain/platform/integrations/service";
import { refreshManifests, setPluginActive } from "@plugin-host/service";
import "@/app/plugin-wiring";
import { eq } from "drizzle-orm";
import { closeDatabase, resetDatabase } from "../../../../../../../test/db";
import { bankAccess, BANK_NOW, fakePlugin, PLUGIN } from "../../../../../../../test/bank-plugin";
import { keyServiceAccount } from "../../../../../../../test/investments";
import { createTestUser } from "../../../../../../../test/users";
import { connectionList } from "./connection-list";
import { statusOf } from "./connection-state";
import { TREK_PROVIDER, WALLET_PROVIDER } from "../../../../../../../test/fixtures/providers";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");

let ctx: Ctx;

beforeEach(async () => {
  await resetDatabase();
  ctx = {
    userId: (await createTestUser()).id,
    role: "user",
    locale: "it",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
});
afterAll(closeDatabase);

const NOW = new Date();

/** The page's state of every connection, from the same facts the list reads. */
async function pageStatuses() {
  const connections = await listConnections(ctx);
  return new Map(connections.map((connection) => [connection.id, statusOf({ connection, runs: [] }, NOW)]));
}

describe("the state of GET /connections", () => {
  it("is the page's state for every connection, whatever its state", async () => {
    const wallet = await saveConnection(ctx, { provider: WALLET_PROVIDER, credentials: { token: "t" } });
    const trek = await saveConnection(ctx, { provider: TREK_PROVIDER, credentials: { token: "t" } });
    await markConnection(ctx, wallet.id, "active", undefined, NOW);
    await markConnection(ctx, trek.id, "revoked");

    let rows = await connectionList(ctx, NOW);
    let page = await pageStatuses();
    expect(rows.map((row) => [row.id, row.status])).toEqual(rows.map((row) => [row.id, page.get(row.id)]));
    expect(rows.find((row) => row.id === wallet.id)?.status).toEqual({
      value: "ok",
      text: "ok",
      action: null,
    });
    expect(rows.find((row) => row.id === trek.id)?.status).toEqual({
      value: "action",
      text: "keyInvalid",
      action: "replaceKey",
    });

    // No schedule: paused, with "Resume".
    await getDb()
      .update(integrationConnections)
      .set({ schedule: { rules: [] } })
      .where(eq(integrationConnections.id, wallet.id));
    rows = await connectionList(ctx, NOW);
    page = await pageStatuses();
    const row = rows.find((one) => one.id === wallet.id);
    expect(row?.status).toEqual(page.get(wallet.id));
    expect(row?.status).toEqual({ value: "paused", text: "pausedSchedule", action: "resume" });
  });
});

describe("the failures of GET /connections", () => {
  it("says the failed readings in a row of each connection, 0 for a new one", async () => {
    const wallet = await saveConnection(ctx, { provider: WALLET_PROVIDER, credentials: { token: "t" } });
    expect((await connectionList(ctx, NOW)).find((row) => row.id === wallet.id)?.consecutiveFailures).toBe(0);

    await getDb()
      .update(integrationConnections)
      .set({ consecutiveFailures: 3 })
      .where(eq(integrationConnections.id, wallet.id));
    expect((await connectionList(ctx, NOW)).find((row) => row.id === wallet.id)?.consecutiveFailures).toBe(3);
  });
});

describe("the depth of history of GET /connections", () => {
  it("is the months the movements' cursor reads today, null for a provider without a depth", async () => {
    const wallet = await saveConnection(ctx, { provider: WALLET_PROVIDER, credentials: { token: "t" } });
    const trek = await saveConnection(ctx, { provider: TREK_PROVIDER, credentials: { token: "t" } });
    const depthOf = async (id: string) =>
      (await connectionList(ctx, NOW)).find((row) => row.id === id)?.historyDepth;
    expect(await depthOf(wallet.id)).toBe(FIRST_LINK_MONTHS);
    expect(await depthOf(trek.id)).toBeNull();

    await saveSyncJob(ctx, wallet.id, "transactions", { cursor: { [BACKFILL_MONTHS]: "36" } });
    expect(await depthOf(wallet.id)).toBe(36);
  });
});

describe("the runs of GET /connections", () => {
  /** The answer of the route, as the client reads it. */
  async function viaRoute(path: string) {
    const routes = apiRoutes({
      ...adapters,
      guard: () => async (context, next) => {
        context.set("ctx", ctx);
        await next();
      },
    });
    return routes.request(path);
  }

  it("gives 10 runs of each connection, or the `runs` asked for up to 40", async () => {
    const wallet = await saveConnection(ctx, { provider: WALLET_PROVIDER, credentials: { token: "t" } });
    for (let i = 0; i < 45; i += 1) await recordRun(ctx, { connectionId: wallet.id, kind: "transactions" });
    const runsOf = async (path: string) => {
      const response = await viaRoute(path);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { connections: { id: string; runs: unknown[] }[] };
      return body.connections.find((row) => row.id === wallet.id)?.runs.length;
    };
    expect(await runsOf("/connections")).toBe(10);
    expect(await runsOf("/connections?runs=25")).toBe(25);
    expect(await runsOf("/connections?runs=40")).toBe(40);
    expect((await viaRoute("/connections?runs=41")).status).toBe(400);
    expect((await viaRoute("/connections?runs=0")).status).toBe(400);
  });
});

describe("the services of Investments in GET /connections", () => {
  it("says the account of a service with a key, whose page has its settings", async () => {
    const connection = await saveConnection(ctx, { provider: ETORO_PROVIDER, credentials: { token: "t" } });
    const wallet = await saveConnection(ctx, { provider: WALLET_PROVIDER, credentials: { token: "t" } });
    // Without its account a service has no row.
    expect((await connectionList(ctx, NOW)).some((row) => row.id === connection.id)).toBe(false);

    const account = await keyServiceAccount(ctx, ETORO_PROVIDER);
    const rows = await connectionList(ctx, NOW);
    expect(rows.find((row) => row.id === connection.id)?.service).toEqual({ accountId: account.accountId });
    expect(rows.find((row) => row.id === wallet.id)?.service).toBeNull();
  });
});

describe("the accounts a bank shares in GET /connections", () => {
  it("are said for the bank of a plugin on and of a plugin paused, null for a source of the core", async () => {
    const plugin = fakePlugin();
    await refreshManifests(BANK_NOW, plugin.deps);
    const bank = await bankAccess(ctx, plugin);
    const wallet = await saveConnection(ctx, { provider: WALLET_PROVIDER, credentials: { token: "t" } });
    let rows = await connectionList(ctx, NOW);
    expect(rows.find((row) => row.id === bank)?.shared).toBe(1);
    expect(rows.find((row) => row.id === wallet.id)?.shared).toBeNull();

    await setPluginActive(ctx, { pluginId: PLUGIN, active: false }, BANK_NOW);
    rows = await connectionList(ctx, NOW);
    expect(rows.find((row) => row.id === bank)).toMatchObject({ providerActive: false, shared: 1 });
  });
});
