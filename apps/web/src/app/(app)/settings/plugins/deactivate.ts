// src/app/(app)/settings/plugins/deactivate.ts — "Turn off" a source (plugin-settings.md §3,
// decision H55): every connection closes, the source's settings go, and its data become data of the
// core, with no number changed. Here and not in a module because it joins six: each owner converts
// its own rows, all of them in one transaction. No provider is named here (rule M12): a source is a
// provider id, and what it syncs says which parts apply.
import "server-only";
import { listAccounts } from "@ledgerly/domain/accounts";
import { releaseSourceAccounts } from "@ledgerly/domain/accounts";
import { publishingRuleCount, stopPublishingOnAccounts } from "@ledgerly/domain/interests";
import { forgetPendingDays, pendingCount } from "@ledgerly/domain/timeoff";
import { forgetSends, pendingSends } from "@ledgerly/domain/transactions";
import { forgetSourceCategories, sourceCategoryCount } from "@ledgerly/domain/transactions";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { getDb } from "@ledgerly/domain/platform/db";
import { isBankPlugin, pluginProvider } from "@ledgerly/domain/platform/integrations";
import { countTransactions } from "@ledgerly/domain/transactions";
import {
  forgetSource,
  listConnections,
  runningSince,
  stopReadings,
} from "@ledgerly/domain/platform/integrations";
import { PLUGIN_ID } from "@ledgerly/plugin-contract";
import {
  credentialsStatus,
  isPluginActive,
  pluginLifecycle,
  pluginManifest,
} from "@ledgerly/domain/platform/plugins";
import { type Deps as PluginDeps, forgetPlugin, prepareAccessClosing } from "@ledgerly/plugin-host";

/** A source the person can turn off: a provider of the core with a page, or a plugin they have on. */
export interface Source {
  provider: string;
  /** The plugin's id; `null` for a provider of the core that is no plugin. */
  pluginId: string | null;
  /** Whether the source keeps the days of Time Off: its changes waiting are counted and dropped. */
  days: boolean;
  /** A bank: the person chooses which of its accounts are read here; a source keeps them all. */
  bank: boolean;
}

/** Why «Turn off» did nothing, as the client says it (H56); `failed` without one. */
export type DeactivateReason = "not_active" | "reading_in_progress" | "plugin_down";

export class DeactivateError extends Error {
  constructor(
    readonly code: "not_found" | "failed",
    /** H56: the cause of a `failed`, and for `reading_in_progress` when the reading started. */
    readonly refusal: { reason: DeactivateReason; startedAt?: Date } | null = null,
  ) {
    super(code);
    this.name = "DeactivateError";
  }
}

/**
 * The source of a page's slug, or `null` when the person has no such source to turn off. A plugin
 * read by an engine of the core (a source read with a token, a leave calendar: its manifest says)
 * has its page whether it is on or not, and turning it off turns the plugin off too.
 */
export async function sourceOf(ctx: Pick<Ctx, "userId">, slug: string): Promise<Source | null> {
  if (!PLUGIN_ID.test(slug)) return null;
  const provider = pluginProvider(slug);
  const capabilities = (await pluginManifest(slug))?.capabilities ?? [];
  if (!isBankPlugin(capabilities))
    return { provider, pluginId: slug, days: capabilities.includes("leaveCalendar"), bank: false };
  if (!(await isPluginActive(ctx, slug))) return null;
  return { provider, pluginId: slug, days: false, bank: true };
}

/**
 * The source «Turn off» and its dialog work on (H56, D1 = A): `sourceOf`'s, and also a bank's plugin
 * that is off, so the data that still depend on it can be converted. `deactivateSource` refuses one
 * with nothing left.
 */
export async function sourceToTurnOff(ctx: Pick<Ctx, "userId">, slug: string): Promise<Source | null> {
  const source = await sourceOf(ctx, slug);
  if (source !== null || !PLUGIN_ID.test(slug) || (await pluginManifest(slug)) === null) return source;
  return { provider: pluginProvider(slug), pluginId: slug, days: false, bank: true };
}

/** What the dialog says before it opens (§3.3): only the lines above 0 are shown. */
export interface DeactivationCounts {
  accounts: number;
  categories: number;
  rules: number;
  unsent: number;
  pendingDays: number;
}

/** The source's accounts here, archived ones too: what «Turn off» converts. */
async function accountIdsOf(ctx: Pick<Ctx, "userId">, source: Source): Promise<string[]> {
  return (await listAccounts(ctx, { includeArchived: true }))
    .filter((account) => account.provider === source.provider)
    .map((account) => account.id);
}

export async function deactivationCounts(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  source: Source,
): Promise<DeactivationCounts> {
  const ids = await accountIdsOf(ctx, source);
  const [categories, rules, unsent, pendingDays] = await Promise.all([
    sourceCategoryCount(ctx, source.provider),
    publishingRuleCount(ctx, ids),
    // shortcut: counts up to 1000 waiting movements; a person with more sees 1000.
    pendingSends(ctx, ids, 1000).then((rows) => rows.length),
    source.days ? pendingCount(ctx) : 0,
  ]);
  return { accounts: ids.length, categories, rules, unsent, pendingDays };
}

/**
 * What the dialog says besides the counts (H56): the movements on the accounts, which stay kept by
 * hand, and whether credentials are saved, which go.
 */
export async function deactivationExtras(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  source: Source,
): Promise<{ movements: number; credentials: boolean }> {
  const ids = await accountIdsOf(ctx, source);
  const [movements, credentials] = await Promise.all([
    ids.length > 0 ? countTransactions(ctx, { accountIds: ids, includeHidden: true }) : 0,
    source.pluginId === null ? false : credentialsStatus(ctx, source.pluginId).then((one) => one.saved),
  ]);
  return { movements, credentials };
}

/** How long the last reading before turning off may take (§3.2, step 1). */
const FINAL_READ_MS = 30_000;

/** After this long a reading that still runs may be stopped by «Stop the reading and deactivate» (H56, D3). */
export const STOP_READING_AFTER_MS = 15 * 60_000;

interface DeactivateDeps {
  /** One last reading of a connection, which also sends what waits; its failure does not stop. */
  finalRead(connectionId: string): Promise<unknown>;
  plugin?: PluginDeps;
  finalReadMs?: number;
  /** «Deactivate anyway»: the plugin that does not answer is not asked to close the accesses. */
  force?: boolean;
  /** «Stop the reading and deactivate»: a reading older than 15 minutes stops first. */
  stopReading?: boolean;
}

/**
 * A reading of these connections that is still running refuses «Turn off», with since when; one
 * older than 15 minutes is stopped first when the person asked (H56, D3 = A).
 */
async function waitForNoReading(
  ctx: Pick<Ctx, "userId">,
  connectionIds: readonly string[],
  stopReading: boolean,
  now: Date,
): Promise<void> {
  let since = await runningSince(ctx, connectionIds, now);
  if (since !== null && stopReading && now.getTime() - since.getTime() >= STOP_READING_AFTER_MS) {
    await stopReadings(ctx, connectionIds, new Date(now.getTime() - STOP_READING_AFTER_MS), now);
    since = await runningSince(ctx, connectionIds, now);
  }
  if (since !== null)
    throw new DeactivateError("failed", { reason: "reading_in_progress", startedAt: since });
}

/**
 * A plugin that is off can still be turned off while something depends on it (H56, D1 = A: the way
 * out of «needs cleanup»); one with nothing left is refused, as nothing would change.
 */
async function requireSomethingToTurnOff(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  source: Source,
  connections: number,
): Promise<void> {
  if (source.pluginId === null || (await isPluginActive(ctx, source.pluginId))) return;
  const [counts, { credentials }] = await Promise.all([
    deactivationCounts(ctx, source),
    deactivationExtras(ctx, source),
  ]);
  const state = pluginLifecycle({
    active: false,
    connections,
    hasCredentials: credentials,
    leftovers: {
      accounts: counts.accounts,
      categories: counts.categories,
      pendingTx: counts.unsent,
      pendingDays: counts.pendingDays,
    },
  });
  if (state === "not_active") throw new DeactivateError("failed", { reason: "not_active" });
}

/**
 * Turns the source off in the order of §3.2: 1) a last reading of each connection, which sends
 * the movements waiting, when it answers in time; 2) the conversion, in one transaction — an error
 * there undoes all of it and the source stays on; 3) the bank accesses closed; 4) the settings,
 * deleted in the same transaction as 2, so nothing is left half done.
 *
 * A reading still running is a refusal ("nothing changed"), with since when, not a step skipped: it
 * would write accounts and movements of the source while they are converted. A plugin that does not
 * answer, with accesses to close, is a refusal too, unless the person turns it off all the same
 * (H56). Returns how many accounts are now kept by hand.
 */
export async function deactivateSource(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  source: Source,
  deps: DeactivateDeps,
  now: Date = new Date(),
): Promise<{ accounts: number }> {
  const connections = (await listConnections(ctx)).filter((one) => one.provider === source.provider);
  const ids = connections.map((one) => one.id);
  await requireSomethingToTurnOff(ctx, source, connections.length);
  await waitForNoReading(ctx, ids, deps.stopReading === true, now);
  for (const connection of connections) {
    let timer: NodeJS.Timeout | undefined;
    const started = new Date();
    const late = new Promise<"late">((resolve) => {
      timer = setTimeout(() => resolve("late"), deps.finalReadMs ?? FINAL_READ_MS);
    });
    const read = deps.finalRead(connection.id).then(
      () => "read" as const,
      () => "failed" as const,
    );
    const outcome = await Promise.race([read, late]);
    clearTimeout(timer);
    if (outcome === "late")
      throw new DeactivateError("failed", { reason: "reading_in_progress", startedAt: started });
  }
  // A reading of the dispatcher, or one the last reading found running ("busy"), is not over:
  // it would write the source's accounts again after the conversion. Nothing has changed yet.
  await waitForNoReading(ctx, ids, false, now);

  const closeAccesses =
    source.pluginId === null
      ? async () => {}
      : await prepareAccessClosing(ctx, source.pluginId, deps.plugin, { force: deps.force === true });

  const released = await getDb().transaction(async (tx) => {
    const accounts = await releaseSourceAccounts(tx, ctx, source.provider, now);
    const accountIds = accounts.map((account) => account.id);
    await stopPublishingOnAccounts(tx, ctx, accountIds);
    await forgetSends(tx, ctx, accountIds);
    await forgetSourceCategories(tx, ctx, source.provider);
    if (source.days) await forgetPendingDays(tx, ctx, now);
    await forgetSource(tx, ctx, source.provider);
    if (source.pluginId !== null) await forgetPlugin(tx, ctx, source.pluginId, now);
    return accounts.length;
  });

  await closeAccesses();
  return { accounts: released };
}
