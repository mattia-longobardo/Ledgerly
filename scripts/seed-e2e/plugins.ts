// scripts/seed-e2e/plugins.ts — one user per column of the matrix of the plugins' states (H56, PERS-614,
// tests/e2e/connections/plugin-states.spec.ts): each user has Wallet, Trek and Enable Banking in one
// state each, so every cell of «plugin × state» has a list row, a page and the other pages to look at.
// Nothing here can be read for real: no credential is one, and the worker of a preview has no schedule.
import { eq } from "drizzle-orm";
import { BANK_PLUGIN_ID as BANK_PLUGIN } from "../../apps/web/src/app/(app)/banks/plugin";
import { deactivateSource, sourceOf } from "../../apps/web/src/app/(app)/settings/plugins/deactivate";
import { applyProviderAccounts } from "@domain/modules/accounts/service";
import { parseKeyRing, sealJson } from "@domain/platform/crypto";
import type { Ctx } from "@domain/platform/context";
import { getDb } from "@domain/platform/db/client";
import { readEnv } from "@domain/platform/env";
import { pluginProvider } from "@domain/platform/integrations/rules";
import { integrationConnections, syncRuns } from "@domain/platform/integrations/schema";
import { saveConnection, savePluginConnection, saveSchedule } from "@domain/platform/integrations/service";
import { findInstancePlugin } from "@domain/platform/plugins/queries";
import { BANK_SCHEDULE } from "@domain/platform/plugins/rules";
import { pluginUserCredentials } from "@domain/platform/plugins/schema";
import { connectionBag, setPluginActive } from "@plugin-host/service";
import { USERS } from "../../tests/e2e/_shared/env";
import { contextOf } from "./common";
import { seedTimeOff } from "./timeoff";
import { seedSources } from "./transactions";
import { TREK_PROVIDER, WALLET_PROVIDER } from "../../test/fixtures/providers";

type Health = Partial<typeof integrationConnections.$inferInsert>;

const hoursFrom = (now: Date, count: number) => new Date(now.getTime() + count * 3_600_000);

/** Turns a plugin on, when the instance has it (the bank plugin needs its container). */
async function activate(ctx: Ctx, pluginId: string): Promise<boolean> {
  if (!(await findInstancePlugin(pluginId))) return false;
  await setPluginActive(ctx, { pluginId, active: true });
  return true;
}

/** A Wallet or Trek connection with a schedule or none, and the facts of its health. */
async function coreConnection(
  ctx: Ctx,
  provider: string,
  facts: { scheduled: boolean; health?: Health },
): Promise<string> {
  const credentials: Record<string, string> =
    provider === TREK_PROVIDER
      ? { baseUrl: "https://trek.invalid", token: "e2e-not-a-token" }
      : { token: "e2e-not-a-token" };
  const connection = await saveConnection(ctx, { provider, credentials });
  await saveSchedule(ctx, connection.id, facts.scheduled ? BANK_SCHEDULE : { rules: [] });
  const now = new Date();
  await getDb()
    .update(integrationConnections)
    .set({
      nextSyncAt: facts.scheduled ? hoursFrom(now, 48) : null,
      lastOkAt: hoursFrom(now, -1),
      ...facts.health,
    })
    .where(eq(integrationConnections.id, connection.id));
  return connection.id;
}

/** One account of a provider, as its reading adopts it. */
async function providerAccount(ctx: Ctx, provider: string, id: string, name: string): Promise<void> {
  await applyProviderAccounts(ctx, provider, [
    { provider, providerAccountId: id, name, type: "checking", currency: "EUR" },
  ]);
}

/** The bank plugin's credentials, sealed as the app seals them and never checked. */
async function bankCredentials(ctx: Ctx): Promise<void> {
  await getDb()
    .insert(pluginUserCredentials)
    .values({
      userId: ctx.userId,
      pluginId: BANK_PLUGIN,
      credentials: sealJson(parseKeyRing(readEnv().APP_ENCRYPTION_KEY), {
        applicationId: "e2e-not-an-application",
        privateKey: "e2e-not-a-key",
      }),
      savedAt: new Date(),
    });
}

/** One bank of the bank plugin, with its account, its health and a reading that runs since `running`. */
async function bank(
  ctx: Ctx,
  name: string,
  facts: { expiresAt?: Date; health?: Health; running?: Date } = {},
): Promise<string> {
  const now = new Date();
  const slug = name.toLowerCase().replaceAll(" ", "-");
  const provider = pluginProvider(BANK_PLUGIN);
  const account = {
    externalId: `e2e-${slug}`,
    stableId: `e2e-stable-${slug}`,
    name: `${name} current account`,
    identifier: null,
    currency: "EUR",
    kind: "CACC",
  };
  const connection = await savePluginConnection(ctx, {
    provider,
    instanceKey: `IT:${name}`,
    credentials: connectionBag("e2e-not-a-session", [account], { chosen: true, skipped: [] }),
    expiresAt: facts.expiresAt ?? hoursFrom(now, 24 * 170),
  });
  await saveSchedule(ctx, connection.id, BANK_SCHEDULE);
  await getDb()
    .update(integrationConnections)
    .set({ nextSyncAt: hoursFrom(now, 48), lastOkAt: hoursFrom(now, -2), ...facts.health })
    .where(eq(integrationConnections.id, connection.id));
  if (facts.running) {
    await getDb().insert(syncRuns).values({
      userId: ctx.userId,
      connectionId: connection.id,
      kind: "transactions",
      state: "running",
      startedAt: facts.running,
      finishedAt: null,
      counts: {},
      origin: "auto",
      appVersion: "e2e",
    });
  }
  await providerAccount(ctx, provider, account.stableId, account.name);
  return connection.id;
}

/** Never turned on: «Not active» ×3. Nothing to seed but the user. */
export async function seedPluginsOff(): Promise<void> {
  await contextOf(USERS.pluginsOff.email);
}

/** On with nothing yet: «Not connected» ×3. */
export async function seedPluginsOn(): Promise<void> {
  const ctx = await contextOf(USERS.pluginsOn.email);
  for (const id of ["wallet", "trek", BANK_PLUGIN]) await activate(ctx, id);
}

/** Wallet up to date, Trek late (the provider's limit), a bank reading now. */
export async function seedPluginsLive(): Promise<void> {
  const ctx = await contextOf(USERS.pluginsLive.email);
  const now = new Date();
  await activate(ctx, "wallet");
  await coreConnection(ctx, WALLET_PROVIDER, { scheduled: true });
  await providerAccount(ctx, WALLET_PROVIDER, "e2e-live-wallet", "Wallet everyday");
  await activate(ctx, "trek");
  await coreConnection(ctx, TREK_PROVIDER, {
    scheduled: true,
    health: { errorCode: "rate_limited", lastOkAt: hoursFrom(now, -26) },
  });
  if (!(await activate(ctx, BANK_PLUGIN))) return;
  await bankCredentials(ctx);
  // Half an hour from now: still «in progress», and not an orphan, when a long run opens the page.
  await bank(ctx, "Alfa Bank", { running: hoursFrom(now, 0.5) });
}

/** Wallet failed with no schedule (an error, never «on demand»), Trek failing, a bank's access ended. */
export async function seedPluginsErrors(): Promise<void> {
  const ctx = await contextOf(USERS.pluginsErrors.email);
  const now = new Date();
  await activate(ctx, "wallet");
  await coreConnection(ctx, WALLET_PROVIDER, {
    scheduled: false,
    health: {
      state: "error",
      errorCode: "provider_down",
      consecutiveFailures: 1,
      lastOkAt: hoursFrom(now, -30),
    },
  });
  await activate(ctx, "trek");
  await coreConnection(ctx, TREK_PROVIDER, {
    scheduled: true,
    health: {
      state: "error",
      errorCode: "provider_down",
      consecutiveFailures: 2,
      lastOkAt: hoursFrom(now, -26),
    },
  });
  if (!(await activate(ctx, BANK_PLUGIN))) return;
  await bankCredentials(ctx);
  await bank(ctx, "Gamma Bank", { expiresAt: hoursFrom(now, -24) });
}

/** Wallet's key refused, Trek up to date, the bank plugin on with its credentials and no bank. */
export async function seedPluginsMixed(): Promise<void> {
  const ctx = await contextOf(USERS.pluginsMixed.email);
  await activate(ctx, "wallet");
  await coreConnection(ctx, WALLET_PROVIDER, {
    scheduled: true,
    health: { state: "error", errorCode: "auth" },
  });
  await activate(ctx, "trek");
  await coreConnection(ctx, TREK_PROVIDER, { scheduled: true });
  if (await activate(ctx, BANK_PLUGIN)) await bankCredentials(ctx);
}

/** On, with the accounts a «Disconnect» kept: Wallet and the bank «Disconnected»; Trek on demand. */
export async function seedPluginsDisconnected(): Promise<void> {
  const ctx = await contextOf(USERS.pluginsDisconnected.email);
  await activate(ctx, "wallet");
  await providerAccount(ctx, WALLET_PROVIDER, "e2e-disc-wallet", "Wallet everyday");
  await activate(ctx, "trek");
  await coreConnection(ctx, TREK_PROVIDER, { scheduled: false });
  if (!(await activate(ctx, BANK_PLUGIN))) return;
  await providerAccount(ctx, pluginProvider(BANK_PLUGIN), "e2e-disc-bank", "Delta Bank current account");
}

/**
 * Off, with data that still depend on them (D1 = A, the case of PERS-614): Wallet's accounts, categories
 * and a movement to send; days off waiting for Trek, and a Trek connection kept from before H55; a
 * bank's account. «Needs cleanup» ×3.
 */
export async function seedPluginsCleanup(email: string = USERS.pluginsCleanup.email): Promise<void> {
  await seedSources(email);
  await seedTimeOff(email);
  const ctx = await contextOf(email);
  await coreConnection(ctx, TREK_PROVIDER, { scheduled: false });
  if (await findInstancePlugin(BANK_PLUGIN))
    await providerAccount(ctx, pluginProvider(BANK_PLUGIN), "e2e-cleanup-bank", "Omega Bank current account");
}

/** Turned off with «Deactivate» after use: «Not active», with the day, and an account kept by hand. */
export async function seedPluginsGone(): Promise<void> {
  const ctx = await contextOf(USERS.pluginsGone.email);
  await activate(ctx, "wallet");
  await coreConnection(ctx, WALLET_PROVIDER, { scheduled: false });
  await providerAccount(ctx, WALLET_PROVIDER, "e2e-gone-wallet", "Wallet everyday");
  await activate(ctx, "trek");
  const banks = await activate(ctx, BANK_PLUGIN);
  const quiet = { finalRead: async () => {}, force: true };
  for (const slug of ["wallet", "trek", ...(banks ? [BANK_PLUGIN] : [])]) {
    const source = await sourceOf(ctx, slug);
    if (source !== null) await deactivateSource(ctx, source, quiet);
  }
}

/**
 * The journey (it changes its data): Wallet and Trek «Needs cleanup» as above, and the bank plugin on
 * with a reading that started 20 minutes ago — «Deactivate» is refused with its cause and then offers
 * «Stop the reading and deactivate».
 */
export async function seedPluginsJourney(): Promise<void> {
  await seedPluginsCleanup(USERS.pluginsJourney.email);
  const ctx = await contextOf(USERS.pluginsJourney.email);
  if (!(await activate(ctx, BANK_PLUGIN))) return;
  await bankCredentials(ctx);
  await bank(ctx, "Kappa Bank", { running: hoursFrom(new Date(), -20 / 60) });
}
