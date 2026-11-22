// What the pages of the sources read on `/api/v1` (client R3): the steps «Accounts» and «Done» of a
// bank, the person's plugins, the page of a source and the log of the readings. Each answer is held
// to its schema of the contract, and another person's connection is a connection that does not
// exist. The bank is a fake plugin (`test/bank-plugin.ts`): no call leaves the test.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS } from "@ledgerly/api-contract";
import type { Ctx } from "@domain/platform/context";
import { listAccounts } from "@domain/modules/accounts/queries";
import { refreshManifests } from "@plugin-host/service";
import { chooseAccounts, readBank } from "@plugin-host/sync";
import { bankAccess, BANK_NOW, fakePlugin, PLUGIN, PROVIDER } from "../../../../../test/bank-plugin";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { contextFor } from "../../../../../test/fixtures";
import { createTestUser } from "../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const { bankSink } = await import("@/app/(app)/banks/sink");
const { sources } = SETTINGS;

async function send(ctx: Ctx, path: string) {
  const routes = apiRoutes({
    ...adapters,
    guard: () => async (context, next) => {
      context.set("ctx", ctx);
      await next();
    },
  });
  const response = await routes.request(path);
  return { status: response.status, body: await response.json() };
}

let alice: Ctx;
let bob: Ctx;

beforeEach(async () => {
  await resetDatabase();
  alice = contextFor((await createTestUser()).id);
  bob = contextFor((await createTestUser()).id);
});

afterAll(closeDatabase);

/** A bank connected by Alice, its accounts not chosen yet. */
async function connectedBank() {
  const plugin = fakePlugin();
  await refreshManifests(BANK_NOW, plugin.deps);
  return { plugin, connectionId: await bankAccess(alice, plugin) };
}

/** The bank's one account chosen as a new account, and read once. */
async function chosenAndRead(plugin: ReturnType<typeof fakePlugin>, connectionId: string) {
  const target = { pluginId: PLUGIN, connectionId };
  await chooseAccounts(
    alice,
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
  await readBank(alice, { ...target, presence: null }, bankSink, BANK_NOW, plugin.deps);
}

describe("the steps of a bank's connection", () => {
  it("offers the accounts to choose, then answers what the reading did", async () => {
    const { plugin, connectionId } = await connectedBank();

    const choice = await send(alice, `/connections/${connectionId}/choice`);
    expect(choice.status).toBe(200);
    const offered = sources.getBankChoice.response.parse(choice.body);
    expect(offered).toMatchObject({ bank: "Zeta Bank", chosen: false, linked: [], existing: [], sameAs: [] });
    expect(offered.accounts).toEqual([
      expect.objectContaining({
        providerAccountId: "hash-1",
        currency: "EUR",
        defaultType: "checking",
        ibanOwner: null,
      }),
    ]);
    // The number is masked: never the whole IBAN.
    expect(offered.accounts[0].legend).toContain("IT60 •••• 3456");
    expect(offered.accounts[0].legend).not.toContain("IT60X0542811101000000123456");
    // Nothing read before the accounts are chosen.
    expect((await send(alice, `/connections/${connectionId}/outcome`)).body).toEqual({
      error: "conflict",
      reason: "not_chosen",
    });

    await chosenAndRead(plugin, connectionId);
    const [account] = await listAccounts(alice);
    // Nothing left to choose, also with the accounts left out offered again.
    for (const path of ["choice", "choice?all=1"]) {
      expect((await send(alice, `/connections/${connectionId}/${path}`)).body).toEqual({
        error: "conflict",
        reason: "complete",
      });
    }
    const outcome = await send(alice, `/connections/${connectionId}/outcome?same=hash-1.${account.id}`);
    expect(outcome.status).toBe(200);
    expect(sources.getBankOutcome.response.parse(outcome.body)).toEqual({
      bank: "Zeta Bank",
      accounts: [
        {
          id: account.id,
          name: "Zeta",
          currency: "EUR",
          movements: 1,
          firstOn: "2026-11-10",
          balance: "100.00",
          shared: true,
        },
      ],
      // The account is tied to the bank already: it is not one to switch.
      switches: [],
      reading: { failed: false, neverRead: false, retryAfter: null, accountErrors: 0 },
      categories: { read: 1, categorised: 0, suggested: 0, open: 1, waiting: 1, any: false },
      reviewAccountIds: [account.id],
      expiresAt: "2027-05-14T09:59:00.000Z",
    });
  });

  it("is not found for another person, nor for a connection that is not a bank", async () => {
    const { connectionId } = await connectedBank();
    for (const step of ["choice", "outcome"]) {
      expect((await send(bob, `/connections/${connectionId}/${step}`)).status).toBe(404);
    }
    expect((await send(alice, "/connections/0b6c3f9e-2d41-4a7b-9c8e-5f1a2b3c4d5e/choice")).status).toBe(404);
  });
});

describe("the plugins, a source's page and the log", () => {
  it("answers the person's plugin with the state of the key, never the key", async () => {
    const fake = fakePlugin();
    await refreshManifests(BANK_NOW, fake.deps);
    expect(sources.listPlugins.response.parse((await send(alice, "/plugins")).body).plugins).toEqual([
      expect.objectContaining({ id: PLUGIN, state: "available", connections: 0, pausedSince: null }),
    ]);
    await bankAccess(alice, fake);
    const [plugin] = sources.listPlugins.response.parse((await send(alice, "/plugins")).body).plugins;
    expect(plugin).toMatchObject({
      state: "active",
      connections: 1,
      credentials: { saved: true, savedAt: BANK_NOW.toISOString(), invalid: false },
    });
    expect(plugin.returnAddress).toMatch(/\/api\/v1\/plugins\/enablebanking\/callback$/);
    expect(JSON.stringify(plugin)).not.toContain("PRIVATE KEY");
    // Bob has the plugin of the instance, not Alice's key.
    expect((await send(bob, "/plugins")).body.plugins[0]).toMatchObject({
      state: "available",
      connections: 0,
    });
  });

  it("answers a source's page: deleted accounts, what waits, what «Disconnect» leaves", async () => {
    const { plugin, connectionId } = await connectedBank();
    await chosenAndRead(plugin, connectionId);
    const page = await send(alice, `/sources/${PLUGIN}`);
    expect(page.status).toBe(200);
    expect(sources.getSource.response.parse(page.body)).toEqual({
      provider: PROVIDER,
      deletedAccounts: [],
      unsent: { count: 0, accountIds: [] },
      pendingDays: 0,
      connections: [{ id: connectionId, shared: 1, leave: { accounts: 1, excluded: 0 } }],
    });
    // A plugin Bob has not turned on, and a source that does not exist, have no page.
    expect((await send(bob, `/sources/${PLUGIN}`)).status).toBe(404);
    expect((await send(alice, "/sources/nothing")).status).toBe(404);
  });

  it("answers the log of the readings, newest first, of one connection or of all", async () => {
    const { plugin, connectionId } = await connectedBank();
    await chosenAndRead(plugin, connectionId);
    await readBank(
      alice,
      { pluginId: PLUGIN, connectionId, presence: null },
      bankSink,
      BANK_NOW,
      plugin.deps,
    );
    const all = sources.listConnectionRuns.response.parse((await send(alice, "/connections/runs")).body);
    expect(all.runs.length).toBeGreaterThanOrEqual(2);
    expect(all.more).toBe(false);
    expect(all.runs.every((run) => run.connectionId === connectionId)).toBe(true);
    const started = all.runs.map((run) => run.startedAt);
    expect(started).toEqual([...started].sort().reverse());

    const one = sources.listConnectionRuns.response.parse(
      (await send(alice, `/connections/runs?connectionId=${connectionId}&limit=1`)).body,
    );
    expect(one).toEqual({ runs: [all.runs[0]], more: true });
    expect((await send(bob, `/connections/runs?connectionId=${connectionId}`)).status).toBe(404);
    expect((await send(bob, "/connections/runs")).body).toEqual({ runs: [], more: false });
  });
});
