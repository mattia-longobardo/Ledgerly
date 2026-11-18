// src/app/(app)/settings/integrations/deactivate-actions.ts — "Turn off" a source and "Bring back"
// an account deleted here (plugin-settings.md §3.3, §3.4): the session and the use cases of
// `deactivate-cases.ts`, which `/api/v1/sources` calls too.
"use server";

import { requireSession } from "@/platform/auth/session";
import { requestPresence } from "../../banks/presence";
import { coreConnectionAction } from "./actions";
import { bringBackAccount, deactivationCountsOf, turnOffSource } from "./deactivate-cases";

/** What the dialog reads before it opens (§3.3). */
export async function deactivationCountsAction(slug: string): ReturnType<typeof deactivationCountsOf> {
  return deactivationCountsOf(await requireSession(), slug);
}

/** "Turn off {provider}": `accounts` is how many accounts are now kept by hand, for the toast. */
export async function deactivateSourceAction(slug: string): ReturnType<typeof turnOffSource> {
  return turnOffSource(await requireSession(), slug, {
    presence: await requestPresence(),
    core: coreConnectionAction,
  });
}

/** "Bring back": a bank's account is chosen again on the bank's page, which `href` opens. */
export async function resumeSourceAccountAction(
  slug: string,
  externalId: string,
): Promise<{ ok: true; href: string | null } | { ok: false }> {
  const outcome = await bringBackAccount(await requireSession(), slug, externalId, {
    presence: await requestPresence(),
    core: coreConnectionAction,
  });
  if (!outcome.ok) return outcome;
  return {
    ok: true,
    href: outcome.reconnect ? `/banks/connect?step=accounts&c=${outcome.reconnect}&all=1` : null,
  };
}
