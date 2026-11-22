// src/app/(app)/settings/integrations/actions.ts — Settings › Integrations: the Wallet link of
// spec §9.1 and the Trek link of §9.2. Both offer the
// same four: save the credential, prove it works, sync on demand, disconnect; and each has its own
// sync schedule (D7). The steps are `core-cases.ts`, which `/api/v1/connections` calls too.
//
// Every one of these is the *user's own* connection (spec §10.3: "Sync now" is per user). None of
// them takes a connection id from the browser — the id is resolved from the session, so a pasted
// uuid cannot point the action at someone else's row — and none of them returns a credential.
"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/platform/auth/session";
import { TREK_PROVIDER, WALLET_PROVIDER } from "@ledgerly/domain/platform/integrations";
import type { CardAccount, CardError } from "@ledgerly/domain/platform/integrations";
import { chooseCoreAccounts, connectCore, coreAccounts, disconnectCore, runCore } from "./core-cases";

/**
 * Why an action refused, as one of the `settings.integrations.errors.*` keys. A code, not a
 * sentence: the card turns it into a catalogued message, so no English text is built here.
 */
type IntegrationActionError = CardError | "schedule";

/**
 * What the card gets back. Deliberately this narrow: there is no field a token could travel in,
 * so no future edit can leak one by accident (spec §9.4, and the card never asks for it back).
 */
export type IntegrationActionResult =
  /** `back`: the accounts a source turned on again tied back (plugin-settings.md §3.4). */
  { ok: true; back?: number } | { ok: false; error: IntegrationActionError };

/** The pages a change of a source's link shows on. */
function revalidate(): void {
  revalidatePath("/settings/integrations", "layout");
  revalidatePath("/subscriptions");
  revalidatePath("/funds");
  revalidatePath("/timeoff");
}

const answer = (outcome: { ok: true } | { ok: false; error: CardError }): IntegrationActionResult => {
  revalidate();
  return outcome.ok ? { ok: true } : { ok: false, error: outcome.error };
};

async function connect(
  provider: string,
  credentials: Record<string, string>,
): Promise<IntegrationActionResult> {
  const outcome = await connectCore(await requireSession(), provider, credentials);
  if (!outcome.ok) return { ok: false, error: outcome.error };
  revalidate();
  return outcome.back > 0 ? { ok: true, back: outcome.back } : { ok: true };
}

/**
 * Stores a Wallet token, whether it is the first one or a replacement. The plaintext lives in this
 * function's argument and in `saveConnection`'s, and in nothing that comes back: the result says
 * `ok` and no more, so the browser learns that the token was accepted and never what it was.
 */
export async function connectWalletAction(token: string): Promise<IntegrationActionResult> {
  return connect(WALLET_PROVIDER, { token });
}

/** One Wallet account on the choice of the card: no id of an account here, only its name. */
export type WalletAccountRow = CardAccount;

/** "Choose the accounts" (PERS-419): the accounts Wallet has now, read when the dialog opens. */
export async function walletAccountsAction(): Promise<
  { ok: true; accounts: WalletAccountRow[] } | { ok: false; error: IntegrationActionError }
> {
  const outcome = await coreAccounts(await requireSession(), WALLET_PROVIDER);
  return outcome.ok ? outcome : { ok: false, error: outcome.error };
}

/**
 * Saves which Wallet accounts not here arrive here. When one comes back, the history is downloaded
 * again and the pass runs now, as "Download the history again" does.
 */
export async function chooseWalletAccountsAction(chosen: string[]): Promise<IntegrationActionResult> {
  const ctx = await requireSession();
  if (!Array.isArray(chosen) || chosen.some((id) => typeof id !== "string"))
    return { ok: false, error: "failed" };
  return answer(await chooseCoreAccounts(ctx, WALLET_PROVIDER, chosen));
}

/**
 * Drops the token and this connection's own history. The links stay — that is what makes
 * reconnecting cheap (see `deleteConnection`) — and the accounts and movements already imported
 * stay too, as the confirmation says.
 */
export async function disconnectWalletAction(): Promise<IntegrationActionResult> {
  return answer(await disconnectCore(await requireSession(), WALLET_PROVIDER));
}

/* Trek — the leave calendar (spec §9.2, plan F7 L4) */

/**
 * Stores the Trek URL and token. Like Wallet's, saving and proving are separate: a Trek that is
 * down must not stop a correct token being kept, and "Test connection" is the button that asks.
 */
export async function connectTrekAction(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<IntegrationActionResult> {
  return connect(TREK_PROVIDER, { baseUrl, clientId, clientSecret });
}

/**
 * Drops the Trek token — and, with it, every removal still waiting to be sent. The days themselves
 * stay, as the confirmation says.
 */
export async function disconnectTrekAction(): Promise<IntegrationActionResult> {
  return answer(await disconnectCore(await requireSession(), TREK_PROVIDER));
}

/* The row of a connection (ux/n2-connection-status.md §2.4) */

/**
 * "Update now", "Test the connection" and "Download the history again" for the two providers of this
 * file, by provider id: the row of every connection (`connection-calls.ts`) names no provider and asks here.
 */
export async function coreConnectionAction(
  provider: string,
  kind: "update" | "test" | "history",
  months?: number,
): Promise<IntegrationActionResult> {
  return answer(await runCore(await requireSession(), provider, kind, months));
}
