// "Turn off" a source and "Bring back" an account deleted here (plugin-settings.md §3.3, §3.4) through
// `/api/v1/sources` (rewrite plan R3), with the answers of the Server Actions they replace.
import { banks, connections } from "@ledgerly/api-contract/settings";
import { ApiError, call, type RouteOutput } from "@ledgerly/api-client";
import { invalidate } from "@ledgerly/ui/data";

/** A refusal is `{ ok: false }`, as the actions answered; a failure of the server throws. */
function refused(error: unknown): { ok: false } {
  if (error instanceof ApiError && error.status < 500) return { ok: false };
  throw error;
}

/** What the dialog reads before it opens (§3.3). */
export async function deactivationCountsAction(
  slug: string,
): Promise<{ ok: true; counts: RouteOutput<typeof banks.getSourceDeactivation> } | { ok: false }> {
  try {
    return { ok: true, counts: await call(banks.getSourceDeactivation, { params: { slug } }) };
  } catch (error) {
    return refused(error);
  }
}

/** Why «Deactivate» did nothing (H56, PERS-615 §5): the cause, and since when a reading runs. */
export type DeactivateRefusal = {
  ok: false;
  /** `reading_in_progress`, `plugin_down`, `not_active`, or a code nobody planned for. */
  reason: string;
  startedAt: string | null;
};

/**
 * «Deactivate {provider}»: `accounts` is how many accounts are now kept by hand, for the toast.
 * `stopReading` stops a reading older than 15 minutes first; `force` turns off a plugin that does not
 * answer (the person closes the access at the provider).
 */
export async function deactivateSourceAction(
  slug: string,
  options: { force?: boolean; stopReading?: boolean } = {},
): Promise<{ ok: true; accounts: number } | DeactivateRefusal> {
  try {
    const { accounts } = await call(banks.deactivateSource, { params: { slug }, body: options });
    invalidate(connections.listConnections);
    return { ok: true, accounts };
  } catch (error) {
    if (error instanceof ApiError && error.status < 500)
      return { ok: false, reason: error.reason ?? error.code, startedAt: error.startedAt };
    throw error;
  }
}

/** "Bring back": a bank's account is chosen again on the bank's page, which `href` opens. */
export async function resumeSourceAccountAction(
  slug: string,
  externalId: string,
): Promise<{ ok: true; href: string | null } | { ok: false }> {
  try {
    const { reconnect } = await call(banks.resumeSourceAccount, { params: { slug, externalId } });
    invalidate(connections.listConnections);
    return { ok: true, href: reconnect ? `/banks/connect?step=accounts&c=${reconnect}&all=1` : null };
  } catch (error) {
    return refused(error);
  }
}
