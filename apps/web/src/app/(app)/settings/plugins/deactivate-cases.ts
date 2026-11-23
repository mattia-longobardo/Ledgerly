// src/app/(app)/settings/plugins/deactivate-cases.ts — "Turn off" a source and "Bring back"
// an account deleted here (plugin-settings.md §3.3, §3.4), as use cases: the Server Actions and
// `/api/v1/sources` call these. The source comes from a slug, read among the person's own sources.
import "server-only";
import { revalidatePath } from "next/cache";
import { redactForLog } from "@ledgerly/domain/platform/auth";
import type { Ctx } from "@ledgerly/domain/platform/context";
import {
  changeSourceSkippedIds,
  deletedSourceAccounts,
  listConnections,
  readSyncJob,
} from "@ledgerly/domain/platform/integrations";
import { connectionSharing, historyOf, type Presence } from "@ledgerly/plugin-host";
import { type CoreConnection, runConnection } from "./connection-cases";
import {
  DeactivateError,
  type DeactivationCounts,
  deactivateSource,
  deactivationCounts,
  sourceOf,
} from "./deactivate";

function revalidate(): void {
  revalidatePath("/settings/plugins", "layout");
  revalidatePath("/accounts", "layout");
  revalidatePath("/timeoff", "layout");
  revalidatePath("/expenses", "layout");
}

/** What the dialog reads before it opens (§3.3). */
export async function deactivationCountsOf(
  ctx: Ctx,
  slug: string,
): Promise<{ ok: true; counts: DeactivationCounts } | { ok: false }> {
  const source = await sourceOf(ctx, slug);
  if (source === null) return { ok: false };
  try {
    return { ok: true, counts: await deactivationCounts(ctx, source) };
  } catch (error) {
    console.error("[integrations] the counts of a deactivation failed", redactForLog(error));
    return { ok: false };
  }
}

/** "Turn off {provider}": `accounts` is how many accounts are now kept by hand, for the toast. */
export async function turnOffSource(
  ctx: Ctx,
  slug: string,
  reading: { presence: Presence | null; core: CoreConnection },
): Promise<{ ok: true; accounts: number } | { ok: false }> {
  const source = await sourceOf(ctx, slug);
  if (source === null) return { ok: false };
  try {
    const { accounts } = await deactivateSource(ctx, source, {
      // As the row's action did: a reading that fails is not a failure of turning off.
      finalRead: (connectionId) => runConnection(ctx, connectionId, "update", reading).catch(() => null),
    });
    revalidate();
    return { ok: true, accounts };
  } catch (error) {
    if (!(error instanceof DeactivateError)) {
      console.error("[integrations] a deactivation failed", redactForLog(error));
    }
    return { ok: false };
  }
}

/**
 * "Bring back" an account deleted here (§3.4): the source may bring it again. A source that reads
 * a chosen depth reads its history again now, as deep as before, so the movements come back too;
 * a bank's account is chosen again on the bank's page, which `href` opens.
 */
export async function bringBackAccount(
  ctx: Ctx,
  slug: string,
  externalId: string,
  reading: { presence: Presence | null; core: CoreConnection },
): Promise<{ ok: true; reconnect: string | null } | { ok: false }> {
  const source = await sourceOf(ctx, slug);
  if (source === null || typeof externalId !== "string") return { ok: false };
  const deleted = await deletedSourceAccounts(ctx, source.provider);
  if (!deleted.some((one) => one.externalId === externalId)) return { ok: false };
  try {
    await changeSourceSkippedIds(ctx, source.provider, { remove: [externalId] });
    revalidate();
    if (source.pluginId !== null) {
      const shared = await connectionSharing(ctx, source.pluginId, externalId);
      return { ok: true, reconnect: shared ? shared.connection.id : null };
    }
    const connection = (await listConnections(ctx)).find((one) => one.provider === source.provider);
    const history = await historyOf(source.provider);
    if (connection && history) {
      const job = await readSyncJob(ctx, connection.id, "transactions");
      // A reading that fails now is not a failure of "Bring back": the next one brings it.
      await runConnection(ctx, connection.id, "history", {
        ...reading,
        months: history.depthOf(job?.cursor),
      }).catch(() => null);
    }
    return { ok: true, reconnect: null };
  } catch (error) {
    console.error("[integrations] an account could not be brought back", redactForLog(error));
    return { ok: false };
  }
}
