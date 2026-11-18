// src/app/(app)/settings/integrations/deactivate-actions.ts — "Turn off" a source and "Bring back"
// an account deleted here (plugin-settings.md §3.3, §3.4). Thin wrappers around `deactivate.ts`:
// the source comes from the page's slug, read among the signed-in person's own sources.
"use server";

import { revalidatePath } from "next/cache";
import { redactForLog } from "@ledgerly/domain/platform/auth";
import { requireSession } from "@/platform/auth/session";
import { passFor } from "@/platform/integrations/registry";
import {
  changeSourceSkippedIds,
  deletedSourceAccounts,
  listConnections,
  readSyncJob,
} from "@ledgerly/domain/platform/integrations";
import { connectionSharing } from "@ledgerly/plugin-host";
import { runConnectionAction } from "./connection-actions";
import {
  DeactivateError,
  type DeactivationCounts,
  deactivateSource,
  deactivationCounts,
  sourceOf,
} from "./deactivate";

function revalidate(): void {
  revalidatePath("/settings/integrations", "layout");
  revalidatePath("/accounts", "layout");
  revalidatePath("/timeoff", "layout");
  revalidatePath("/expenses", "layout");
}

/** What the dialog reads before it opens (§3.3). */
export async function deactivationCountsAction(
  slug: string,
): Promise<{ ok: true; counts: DeactivationCounts } | { ok: false }> {
  const ctx = await requireSession();
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
export async function deactivateSourceAction(
  slug: string,
): Promise<{ ok: true; accounts: number } | { ok: false }> {
  const ctx = await requireSession();
  const source = await sourceOf(ctx, slug);
  if (source === null) return { ok: false };
  try {
    const { accounts } = await deactivateSource(ctx, source, {
      finalRead: (connectionId) => runConnectionAction(connectionId, "update"),
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
export async function resumeSourceAccountAction(
  slug: string,
  externalId: string,
): Promise<{ ok: true; href: string | null } | { ok: false }> {
  const ctx = await requireSession();
  const source = await sourceOf(ctx, slug);
  if (source === null || typeof externalId !== "string") return { ok: false };
  const deleted = await deletedSourceAccounts(ctx, source.provider);
  if (!deleted.some((one) => one.externalId === externalId)) return { ok: false };
  try {
    await changeSourceSkippedIds(ctx, source.provider, { remove: [externalId] });
    revalidate();
    if (source.pluginId !== null) {
      const shared = await connectionSharing(ctx, source.pluginId, externalId);
      return {
        ok: true,
        href: shared ? `/banks/connect?step=accounts&c=${shared.connection.id}&all=1` : null,
      };
    }
    const connection = (await listConnections(ctx)).find((one) => one.provider === source.provider);
    const history = passFor(source.provider)?.history;
    if (connection && history) {
      const job = await readSyncJob(ctx, connection.id, "transactions");
      // A reading that fails now is not a failure of "Bring back": the next one brings it.
      await runConnectionAction(connection.id, "history", history.depthOf(job?.cursor));
    }
    return { ok: true, href: null };
  } catch (error) {
    console.error("[integrations] an account could not be brought back", redactForLog(error));
    return { ok: false };
  }
}
