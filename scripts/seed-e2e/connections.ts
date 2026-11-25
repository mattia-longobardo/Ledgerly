// scripts/seed-e2e/connections.ts — the users and the data of the flow `connections` (tests/e2e/connections/).
import { eq } from "drizzle-orm";
import { BANK_PLUGIN_ID as BANK_PLUGIN } from "../../apps/web/src/app/(app)/banks/plugin";
import { accounts } from "@domain/modules/accounts/schema";
import { applyProviderAccounts, createAccount } from "@domain/modules/accounts/service";
import { parseKeyRing, sealJson } from "@domain/platform/crypto";
import { today } from "@domain/shared/dates";
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
import { activatePlugin, contextOf } from "./common";
import { seedBinance, seedEtoro } from "./investments";
import { TREK_PROVIDER, WALLET_PROVIDER } from "../../test/fixtures/providers";

/**
 * Release N2 (ux/n2-connection-status.md): a connection in each of the five states, so the row,
 * its history, "Advanced" and the short form on an account's page are measured with something in
 * them. Nothing here can be read for real: the credentials are not credentials, the schedule's
 * next time is days away, and the users are removed when the run ends — so the dispatcher never
 * calls a provider for this user.
 */
export async function seedConnections(email: string = USERS.connections.email): Promise<void> {
  const ctx = await contextOf(email);
  const db = getDb();
  const now = new Date();
  const hours = (count: number) => new Date(now.getTime() + count * 3_600_000);

  // Paused: a link with no schedule ("Automatic update is off").
  const trek = await saveConnection(ctx, {
    provider: TREK_PROVIDER,
    credentials: { baseUrl: "https://trek.invalid", token: "e2e-not-a-token" },
  });
  await saveSchedule(ctx, trek.id, { rules: [] });
  // UX review, point 4: a calendar whose key may only read is «Read only», on the user whose screens
  // are measured. The journey's user keeps its Trek paused, as its steps expect.
  if (email === USERS.connections.email) {
    await db
      .update(integrationConnections)
      .set({ state: "error", errorCode: "read_only" })
      .where(eq(integrationConnections.id, trek.id));
  }
  // Release N7.2: the page of a source of the core with every section. Paused too: never read.
  const wallet = await saveConnection(ctx, {
    provider: WALLET_PROVIDER,
    credentials: { token: "e2e-not-a-token" },
  });
  await saveSchedule(ctx, wallet.id, { rules: [] });
  // Decision H58: a Wallet account, so "Disconnect" says that no account moves to a bank by itself,
  // and an archived account kept by hand, which a bank's "Choose the accounts" offers to bring back.
  await applyProviderAccounts(ctx, WALLET_PROVIDER, [
    {
      provider: WALLET_PROVIDER,
      providerAccountId: "e2e-wallet-everyday",
      name: "Wallet everyday",
      type: "checking",
      currency: "EUR",
    },
  ]);
  // On, as the migration that made them plugins left them for everyone with a connection: their
  // «Turn off» stays on the page after a «Disconnect» (UX review, point 8).
  for (const provider of [TREK_PROVIDER, WALLET_PROVIDER]) {
    const pluginId = provider.slice("plugin:".length);
    if (await findInstancePlugin(pluginId)) await setPluginActive(ctx, { pluginId, active: true });
  }
  const archived = await createAccount(ctx, { name: "Old savings", type: "savings" });
  await db.update(accounts).set({ state: "archived", archivedAt: now }).where(eq(accounts.id, archived.id));

  // The banks need the plugin of the instance; the seed cannot reach a plugin itself, so the
  // credentials are sealed here as the app would seal them, and never checked.
  if (!(await findInstancePlugin(BANK_PLUGIN))) return;
  await setPluginActive(ctx, { pluginId: BANK_PLUGIN, active: true });
  await db.insert(pluginUserCredentials).values({
    userId: ctx.userId,
    pluginId: BANK_PLUGIN,
    credentials: sealJson(parseKeyRing(readEnv().APP_ENCRYPTION_KEY), {
      applicationId: "e2e-not-an-application",
      privateKey: "e2e-not-a-key",
    }),
    savedAt: now,
  });

  const provider = pluginProvider(BANK_PLUGIN);
  async function bank(
    name: string,
    facts: {
      chosen?: boolean;
      expiresAt?: Date | null;
      health?: Partial<typeof integrationConnections.$inferInsert>;
      runs?: {
        state: "running" | "success" | "failed";
        at: Date;
        origin?: "auto" | "manual";
        errorCode?: string;
        httpStatus?: number;
        counts?: Record<string, number>;
      }[];
    } = {},
  ): Promise<string> {
    const slug = name.toLowerCase().replaceAll(" ", "-");
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
      credentials: connectionBag("e2e-not-a-session", [account], {
        chosen: facts.chosen ?? true,
        skipped: [],
      }),
      expiresAt: facts.expiresAt === undefined ? hours(24 * 170) : facts.expiresAt,
    });
    if (facts.chosen ?? true) await saveSchedule(ctx, connection.id, BANK_SCHEDULE);
    await db
      .update(integrationConnections)
      .set({
        // Days away: no pass of the dispatcher comes while the test users exist.
        nextSyncAt: (facts.chosen ?? true) ? hours(48) : null,
        lastOkAt: hours(-2),
        ...facts.health,
      })
      .where(eq(integrationConnections.id, connection.id));
    for (const run of facts.runs ?? []) {
      await db.insert(syncRuns).values({
        userId: ctx.userId,
        connectionId: connection.id,
        kind: "transactions",
        state: run.state,
        startedAt: run.at,
        finishedAt: run.state === "running" ? null : new Date(run.at.getTime() + 4_000),
        counts: run.counts ?? {},
        origin: run.origin ?? "auto",
        errorCode: run.errorCode ?? null,
        httpStatus: run.httpStatus ?? null,
        appVersion: "e2e",
      });
    }
    return connection.id;
  }

  // Up to date, with a history longer than the ten readings a row shows.
  await bank("Alfa Bank", {
    runs: [
      { state: "success", at: hours(-2), counts: { created: 12, updated: 1 } },
      { state: "success", at: hours(-8), origin: "manual", counts: { created: 0 } },
      ...Array.from({ length: 11 }, (_, index) => ({
        state: "success" as const,
        at: hours(-14 - index * 6),
        counts: { created: index % 3 },
      })),
    ],
  });
  // Delayed: two failures in a row, the last good reading a day ago.
  await bank("Beta Bank", {
    health: { state: "error", errorCode: "provider_down", consecutiveFailures: 2, lastOkAt: hours(-26) },
    runs: [
      { state: "failed", at: hours(-2), errorCode: "provider_down", httpStatus: 503 },
      { state: "failed", at: hours(-8), errorCode: "provider_down", httpStatus: 503 },
      { state: "success", at: hours(-26), counts: { created: 3 } },
    ],
  });
  // Action needed: the access ended yesterday.
  await bank("Gamma Bank", { expiresAt: hours(-24) });
  // In progress. The run starts half an hour from now so that it is still "in progress", and not
  // an orphan, when the last spec of a long run opens the page.
  await bank("Delta Bank", { runs: [{ state: "running", at: new Date(now.getTime() + 30 * 60_000) }] });
  // Up to date, and the access ends in twelve days: the warning under the row.
  await bank("Epsilon Bank", { expiresAt: hours(24 * 12) });
  // Action needed: the access is given, the accounts are not chosen yet.
  await bank("Zeta Bank", { chosen: false, health: { lastOkAt: null } });

  // An account that comes from the first bank: its page shows the state of the connection. The
  // one of Epsilon Bank stays tied when the journey disconnects that bank.
  await applyProviderAccounts(
    ctx,
    provider,
    ["Alfa Bank", "Epsilon Bank"].map((name) => ({
      provider,
      providerAccountId: `e2e-stable-${name.toLowerCase().replaceAll(" ", "-")}`,
      name: `${name} current account`,
      type: "checking" as const,
      currency: "EUR",
    })),
  );
}

/**
 * The sync schedule editor (tests/e2e/connections/schedule.spec.ts): a Trek link and the two
 * services of Investments, all on manual only. Its own user: the spec changes the schedules, while
 * the screens of `layout` are measured with the same three links.
 */
export async function seedSchedule(): Promise<void> {
  const ctx = await contextOf(USERS.schedule.email);
  await activatePlugin(ctx, "trek");
  const trek = await saveConnection(ctx, {
    provider: TREK_PROVIDER,
    credentials: { baseUrl: "https://trek.invalid", token: "e2e-not-a-token" },
  });
  await saveSchedule(ctx, trek.id, { rules: [] });
  const on = today(ctx.timeZone);
  await seedEtoro(ctx, on);
  await seedBinance(ctx, on);
}
