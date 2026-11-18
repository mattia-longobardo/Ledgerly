// src/app/(app)/settings/integrations/deactivate.ts — "Turn off" a source (plugin-settings.md §3,
// decision H55): every connection closes, the source's settings go, and its data become data of the
// core, with no number changed. Here and not in a module because it joins six: each owner converts
// its own rows, all of them in one transaction. No provider is named here (rule M12): a source is a
// provider id, and what it syncs says which parts apply.
import "server-only";
import { listAccounts } from "@/modules/accounts/queries";
import { releaseSourceAccounts } from "@/modules/accounts/service";
import { publishingRuleCount, stopPublishing } from "@/modules/interests/service";
import { forgetPendingDays, pendingCount } from "@/modules/timeoff/service";
import { forgetSends, pendingSends } from "@/modules/transactions/sending";
import { forgetSourceCategories, sourceCategoryCount } from "@/modules/transactions/source-categories";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { isKnownProvider, KINDS_OF, pluginProvider } from "@/platform/integrations/rules";
import { forgetSource, listConnections, runningReadings } from "@/platform/integrations/service";
import { PLUGIN_ID } from "@ledgerly/plugin-contract";
import { isPluginActive } from "@/platform/plugins/queries";
import { type Deps as PluginDeps, forgetPlugin, prepareAccessClosing } from "@/platform/plugins/service";

/** A source the person can turn off: a provider of the core with a page, or a plugin they have on. */
export interface Source {
  provider: string;
  /** The plugin's id; `null` for a provider of the core. */
  pluginId: string | null;
  /** Whether the source keeps the days of Time Off: its changes waiting are counted and dropped. */
  days: boolean;
}

export class DeactivateError extends Error {
  constructor(readonly code: "not_found" | "failed") {
    super(code);
    this.name = "DeactivateError";
  }
}

/** The source of a page's slug, or `null` when the person has no such source to turn off. */
export async function sourceOf(ctx: Pick<Ctx, "userId">, slug: string): Promise<Source | null> {
  if (isKnownProvider(slug)) {
    const kinds: readonly string[] = KINDS_OF[slug];
    // The investment services are not sources with a page: their key lives on the service (§1.1).
    if (!kinds.includes("accounts") && !kinds.includes("leave")) return null;
    return { provider: slug, pluginId: null, days: kinds.includes("leave") };
  }
  if (!PLUGIN_ID.test(slug) || !(await isPluginActive(ctx, slug))) return null;
  return { provider: pluginProvider(slug), pluginId: slug, days: false };
}

/** What the dialog says before it opens (§3.3): only the lines above 0 are shown. */
export interface DeactivationCounts {
  accounts: number;
  categories: number;
  rules: number;
  unsent: number;
  pendingDays: number;
}

export async function deactivationCounts(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  source: Source,
): Promise<DeactivationCounts> {
  const ids = (await listAccounts(ctx, { includeArchived: true }))
    .filter((account) => account.provider === source.provider)
    .map((account) => account.id);
  const [categories, rules, unsent, pendingDays] = await Promise.all([
    sourceCategoryCount(ctx, source.provider),
    publishingRuleCount(ctx, ids),
    // shortcut: counts up to 1000 waiting movements; a person with more sees 1000.
    pendingSends(ctx, ids, 1000).then((rows) => rows.length),
    source.days ? pendingCount(ctx) : 0,
  ]);
  return { accounts: ids.length, categories, rules, unsent, pendingDays };
}

/** How long the last reading before turning off may take (§3.2, step 1). */
export const FINAL_READ_MS = 30_000;

export interface DeactivateDeps {
  /** One last reading of a connection, which also sends what waits; its failure does not stop. */
  finalRead(connectionId: string): Promise<unknown>;
  plugin?: PluginDeps;
  finalReadMs?: number;
}

/**
 * Turns the source off in the order of §3.2: 1) a last reading of each connection, which sends
 * the movements waiting, when it answers in time; 2) the conversion, in one transaction — an error
 * there undoes all of it and the source stays on; 3) the bank accesses closed; 4) the settings,
 * deleted in the same transaction as 2, so nothing is left half done.
 *
 * A reading still running after its time is a refusal ("nothing changed"), not a step skipped: it
 * would write accounts and movements of the source while they are converted. Returns how many
 * accounts are now kept by hand.
 */
export async function deactivateSource(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  source: Source,
  deps: DeactivateDeps,
  now: Date = new Date(),
): Promise<{ accounts: number }> {
  const connections = (await listConnections(ctx)).filter((one) => one.provider === source.provider);
  for (const connection of connections) {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<"late">((resolve) => {
      timer = setTimeout(() => resolve("late"), deps.finalReadMs ?? FINAL_READ_MS);
    });
    const read = deps.finalRead(connection.id).then(
      () => "read" as const,
      () => "failed" as const,
    );
    const outcome = await Promise.race([read, late]);
    clearTimeout(timer);
    if (outcome === "late") throw new DeactivateError("failed");
  }
  // A reading of the dispatcher, or one the last reading found running ("busy"), is not over:
  // it would write the source's accounts again after the conversion. Nothing has changed yet.
  if (
    (await runningReadings(
      ctx,
      connections.map((one) => one.id),
      now,
    )) > 0
  ) {
    throw new DeactivateError("failed");
  }

  const closeAccesses =
    source.pluginId === null ? async () => {} : await prepareAccessClosing(ctx, source.pluginId, deps.plugin);

  const released = await getDb().transaction(async (tx) => {
    const accounts = await releaseSourceAccounts(tx, ctx, source.provider, now);
    const ids = accounts.map((account) => account.id);
    await stopPublishing(tx, ctx, ids);
    await forgetSends(tx, ctx, ids);
    await forgetSourceCategories(tx, ctx, source.provider);
    if (source.days) await forgetPendingDays(tx, ctx, now);
    await forgetSource(tx, ctx, source.provider);
    if (source.pluginId !== null) await forgetPlugin(tx, ctx, source.pluginId, now);
    return accounts.length;
  });

  await closeAccesses();
  return { accounts: released };
}
