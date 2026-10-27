// src/app/(app)/settings/integrations/actions.ts — Settings › Integrations: the Wallet link of
// spec §9.1, the Trek link of §9.2 and the Paperless link of docs/auth-design.md D5. All offer the
// same four: save the credential, prove it works, sync on demand, disconnect; and each has its own
// sync schedule (D7).
//
// Every one of these is the *user's own* connection (spec §10.3: "Sync now" is per user). None of
// them takes a connection id from the browser — the id is resolved from the session, so a pasted
// uuid cannot point the action at someone else's row — and none of them returns a credential.
"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@/platform/context";
import { matchDeposits } from "@/modules/funds/service";
import { checkSubscriptions } from "@/modules/subscriptions/service";
import { refreshRecurrences } from "@/modules/transactions/jobs";
import { linkOwnTransfers } from "@/modules/transactions/service";
import {
  isKnownProvider,
  PAPERLESS_PROVIDER,
  TREK_PROVIDER,
  WALLET_PROVIDER,
} from "@/platform/integrations/rules";
import { BACKFILL_CHOICES } from "@/platform/integrations/wallet/depth";
import { isSyncBusy, requestWalletBackfill, syncWalletNow } from "@/platform/integrations/wallet/sync";
import {
  type Connection,
  deleteConnection,
  IntegrationError,
  listConnections,
  markConnection,
  readCredentials,
  saveConnection,
  saveSchedule,
} from "@/platform/integrations/service";
import {
  isTokenRejected as isPaperlessTokenRejected,
  normalizeBaseUrl,
  originAllowed,
  PaperlessError,
  publicMessage as paperlessPublicMessage,
} from "@/platform/integrations/paperless/client";
import { DEFAULT_PAYSLIP_TYPE, resolveTypes, TYPE_KEYS } from "@/platform/integrations/paperless/mapping";
import { isPaperlessBusy, paperlessClientOf, syncPaperlessNow } from "@/platform/integrations/paperless/sync";
import {
  createWalletClient,
  isTokenRejected,
  isUsableToken,
  WalletError,
} from "@/platform/integrations/wallet/client";
import {
  createTrekClient,
  isTokenRejected as isTrekTokenRejected,
  TrekError,
} from "@/platform/integrations/trek/client";
import { isTrekBusy, syncTrekNow } from "@/platform/integrations/trek/sync";
import { closePendingDeletes } from "@/modules/timeoff/service";
import { readEnv } from "@/platform/env";

/**
 * Why an action refused, as one of the `settings.integrations.errors.*` keys. A code, not a
 * sentence: the card turns it into a catalogued message, so no English text is built here.
 */
export type IntegrationActionError =
  | "rejected"
  | "unreachable"
  | "provider"
  | "empty"
  | "notConnected"
  | "busy"
  | "failed"
  | "types"
  | "schedule"
  | "notAllowed";

/**
 * What the card gets back. Deliberately this narrow: there is no field a token could travel in,
 * so no future edit can leak one by accident (spec §9.4, and the card never asks for it back).
 */
export type IntegrationActionResult = { ok: true } | { ok: false; error: IntegrationActionError };

function revalidate(): void {
  revalidatePath("/settings/integrations");
}

/** The signed-in user's Wallet connection, or `null` when no token has ever been saved. */
async function walletConnection(ctx: Ctx): Promise<Connection | null> {
  const connections = await listConnections(ctx);
  return connections.find((connection) => connection.provider === WALLET_PROVIDER) ?? null;
}

/**
 * A Wallet failure as the card names it, and as the connection records it: a refused token is a
 * fact about the credential (`revoked`), anything else is a bad afternoon (`error`). The mapping
 * is the one agreed with T1.
 */
function walletFailure(error: unknown): { code: IntegrationActionError; detail: string } {
  if (error instanceof WalletError) {
    // Only a real connectivity failure is reported as one. A provider that *answered* — an HTTP
    // status, a body this app cannot read — is a different sentence, and the collaudo of
    // 2026-09-17 showed why it matters: "Wallet could not be reached" sent the owner hunting the
    // network while the answer, and its reason, were sitting in the sync log.
    const code: IntegrationActionError = isTokenRejected(error)
      ? "rejected"
      : error.kind === "network" || error.kind === "timeout"
        ? "unreachable"
        : "provider";
    return { code, detail: error.message };
  }
  return { code: "failed", detail: error instanceof Error ? error.message : "unknown error" };
}

/**
 * Stores a Wallet token, whether it is the first one or a replacement. The plaintext lives in this
 * function's argument and in `saveConnection`'s, and in nothing that comes back: the result says
 * `ok` and no more, so the browser learns that the token was accepted and never what it was.
 *
 * The token is not checked against Wallet here. Saving and proving are separate on purpose — a
 * provider that is down must not stop a correct token being stored — and "Test connection" is the
 * button that asks.
 */
export async function connectWalletAction(token: string): Promise<IntegrationActionResult> {
  const ctx = await requireSession();
  const secret = token.trim();
  if (secret.length === 0) return { ok: false, error: "empty" };
  // A token that cannot be sent as an HTTP header value can never authenticate anything, so it is
  // refused here rather than encrypted and kept: `trim()` only cleans the edges, and a newline in
  // the *middle* (pasted from a wrapped page) makes undici throw an error that quotes the value —
  // which is how a token in clear reaches `sync_runs.error`, `last_error` and this very card.
  // "Wallet rejected that token" is the honest sentence: it is the token that is wrong.
  if (!isUsableToken(secret)) return { ok: false, error: "rejected" };
  try {
    await saveConnection(ctx, { provider: WALLET_PROVIDER, credentials: { token: secret } });
  } catch (error) {
    // `IntegrationError` is the only refusal with a story; it carries a code, never the value it
    // rejected, so nothing here can print the token.
    if (error instanceof IntegrationError) return { ok: false, error: "failed" };
    throw error;
  }
  revalidate();
  return { ok: true };
}

/**
 * Asks Wallet whether the stored token still works, with a real read (spec §9.1) and outside any
 * transaction (spec §4.3) — the answer is applied afterwards, in `markConnection`'s own short
 * write.
 *
 * This is the one place in the route that opens the credential, and it opens it into a local
 * binding that goes straight into the client. It is not logged, not returned and not stored.
 */
export async function testWalletAction(): Promise<IntegrationActionResult> {
  const ctx = await requireSession();
  const connection = await walletConnection(ctx);
  if (!connection) return { ok: false, error: "notConnected" };

  const { token } = await readCredentials(ctx, connection.id);
  try {
    await createWalletClient(token).accounts();
  } catch (error) {
    const { code, detail } = walletFailure(error);
    await markConnection(ctx, connection.id, code === "rejected" ? "revoked" : "error", detail);
    revalidate();
    return { ok: false, error: code };
  }
  await markConnection(ctx, connection.id, "active");
  revalidate();
  return { ok: true };
}

/**
 * "Sync now" (spec §10.3): the user's own connection, on demand. The engine is T8's, and it opens
 * the credential itself — this action hands it an id and nothing else.
 *
 * Running any job as an admin is a different button on a different card, and not F2's.
 */
export async function syncWalletNowAction(): Promise<IntegrationActionResult> {
  const ctx = await requireSession();
  const connection = await walletConnection(ctx);
  if (!connection) return { ok: false, error: "notConnected" };

  try {
    await syncWalletNow(ctx, connection.id);
    await linkOwnTransfers(ctx);
    // What the hourly job does after a pass (spec §10.2): the recurrences, then the subscription
    // check against the movements just brought in (F3; closes the deviation of F2 §11.4).
    await refreshRecurrences(ctx);
    await checkSubscriptions(ctx);
    await matchDeposits(ctx);
    revalidatePath("/subscriptions");
    revalidatePath("/funds");
  } catch (error) {
    // A sync writes rows before it fails, and it records its own `sync_runs` entry either way, so
    // the log is refreshed on the way out of both branches.
    revalidate();
    // The hourly job (or another tab) holds this connection's advisory lock: nothing was written
    // and nothing is wrong, so the card says "already running" instead of blaming the provider.
    if (isSyncBusy(error)) return { ok: false, error: "busy" };
    if (error instanceof IntegrationError) {
      return { ok: false, error: error.code === "not_found" ? "notConnected" : "failed" };
    }
    return { ok: false, error: walletFailure(error).code };
  }
  revalidate();
  return { ok: true };
}

/**
 * "Download the history again" (spec §9.1, F2.5): the next pass reads `months` monthly windows,
 * and it runs now, exactly as "Sync now" does. Only the depths the card offers are accepted — the
 * number comes from the browser. The backfill imports and never removes, so asking for it cannot
 * cost anything already here; if the hourly job holds the connection, the request stays in the
 * cursor and that job's next pass is the backfill.
 */
export async function redownloadWalletHistoryAction(months: number): Promise<IntegrationActionResult> {
  const ctx = await requireSession();
  if (!BACKFILL_CHOICES.some((choice) => choice === months)) return { ok: false, error: "failed" };
  const connection = await walletConnection(ctx);
  if (!connection) return { ok: false, error: "notConnected" };
  await requestWalletBackfill(ctx, connection.id, months);
  return syncWalletNowAction();
}

/**
 * Drops the token and this connection's own history. The links stay — that is what makes
 * reconnecting cheap (see `deleteConnection`) — and the accounts and movements already imported
 * stay too, as the confirmation says.
 */
export async function disconnectWalletAction(): Promise<IntegrationActionResult> {
  const ctx = await requireSession();
  const connection = await walletConnection(ctx);
  if (!connection) return { ok: false, error: "notConnected" };
  try {
    await deleteConnection(ctx, connection.id);
  } catch (error) {
    if (error instanceof IntegrationError) {
      return { ok: false, error: error.code === "not_found" ? "notConnected" : "failed" };
    }
    throw error;
  }
  revalidate();
  return { ok: true };
}

/* Trek — the leave calendar (spec §9.2, plan F7 L4) */

/** The signed-in user's Trek connection, or `null` when nothing has ever been saved. */
async function trekConnectionOf(ctx: Ctx): Promise<Connection | null> {
  const connections = await listConnections(ctx);
  return connections.find((connection) => connection.provider === TREK_PROVIDER) ?? null;
}

/** A Trek failure as the card names it, with the same three senses the Wallet mapping has. */
function trekFailure(error: unknown): { code: IntegrationActionError; detail: string } {
  if (error instanceof TrekError) {
    const code: IntegrationActionError = isTrekTokenRejected(error)
      ? "rejected"
      : error.kind === "network" || error.kind === "timeout"
        ? "unreachable"
        : "provider";
    return { code, detail: error.message };
  }
  return { code: "failed", detail: error instanceof Error ? error.message : "unknown error" };
}

/**
 * Stores the Trek URL and token. Like Wallet's, saving and proving are separate: a Trek that is
 * down must not stop a correct token being kept, and "Test connection" is the button that asks.
 */
export async function connectTrekAction(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<IntegrationActionResult> {
  const ctx = await requireSession();
  const url = baseUrl.trim().replace(/\/+$/, "");
  const id = clientId.trim();
  const secret = clientSecret.trim();
  if (url === "" || id === "" || secret === "") return { ok: false, error: "empty" };
  // A header value is all either may be: a line break pasted out of a wrapped page would otherwise
  // be quoted verbatim into a log and a page (the check Wallet's own token gets).
  if (!isUsableToken(id) || !isUsableToken(secret)) return { ok: false, error: "empty" };
  if (!/^https:\/\/[^\s]+$/.test(url)) return { ok: false, error: "provider" };

  try {
    await saveConnection(ctx, {
      provider: TREK_PROVIDER,
      credentials: { baseUrl: url, clientId: id, clientSecret: secret },
    });
  } catch (error) {
    if (error instanceof IntegrationError) return { ok: false, error: "provider" };
    throw error;
  }
  revalidate();
  return { ok: true };
}

/** Asks Trek for this year, which proves the token without writing anything. */
export async function testTrekAction(): Promise<IntegrationActionResult> {
  const ctx = await requireSession();
  const connection = await trekConnectionOf(ctx);
  if (!connection) return { ok: false, error: "notConnected" };
  try {
    const bag = await readCredentials(ctx, connection.id);
    const client = createTrekClient({
      baseUrl: bag.baseUrl ?? "",
      clientId: bag.clientId ?? "",
      clientSecret: bag.clientSecret ?? "",
    });
    await client.getEntries(new Date().getUTCFullYear());
  } catch (error) {
    const { code, detail } = trekFailure(error);
    await markConnection(ctx, connection.id, code === "rejected" ? "revoked" : "error", detail);
    revalidate();
    return { ok: false, error: code };
  }
  await markConnection(ctx, connection.id, "active");
  revalidate();
  return { ok: true };
}

/** "Sync now" for Trek (spec §10.3). A pass already running is reported, never doubled. */
export async function syncTrekNowAction(): Promise<IntegrationActionResult> {
  const ctx = await requireSession();
  const connection = await trekConnectionOf(ctx);
  if (!connection) return { ok: false, error: "notConnected" };
  try {
    await syncTrekNow(ctx);
  } catch (error) {
    if (isTrekBusy(error)) return { ok: false, error: "busy" };
    const { code } = trekFailure(error);
    revalidate();
    return { ok: false, error: code };
  }
  revalidate();
  revalidatePath("/timeoff");
  return { ok: true };
}

/**
 * Drops the Trek token — and, with it, every removal still waiting to be sent.
 *
 * A row marked `pending = 'delete'` is a day the app has already taken away from the person's
 * view and is only keeping so it can tell Trek to drop it too. Once the link is gone there is
 * nobody left to tell, so keeping it would leave a day nobody can see and nobody can remove
 * (plan F7 §3.4.10). The days themselves stay, as the confirmation says.
 */
export async function disconnectTrekAction(): Promise<IntegrationActionResult> {
  const ctx = await requireSession();
  const connection = await trekConnectionOf(ctx);
  if (!connection) return { ok: false, error: "notConnected" };
  try {
    await deleteConnection(ctx, connection.id);
    await closePendingDeletes(ctx);
  } catch (error) {
    if (error instanceof IntegrationError) {
      return { ok: false, error: error.code === "not_found" ? "notConnected" : "failed" };
    }
    throw error;
  }
  revalidate();
  revalidatePath("/timeoff");
  return { ok: true };
}

/* Paperless — documents pulled from Paperless-ngx (docs/auth-design.md D5) */

async function paperlessConnectionOf(ctx: Ctx): Promise<Connection | null> {
  const connections = await listConnections(ctx);
  return connections.find((connection) => connection.provider === PAPERLESS_PROVIDER) ?? null;
}

/** A Paperless failure as the card names it, with the same senses as Wallet's and Trek's. */
function paperlessFailure(error: unknown): { code: IntegrationActionError; detail: string } {
  if (error instanceof PaperlessError) {
    const code: IntegrationActionError = isPaperlessTokenRejected(error)
      ? "rejected"
      : error.kind === "not_allowed"
        ? "notAllowed"
        : error.kind === "network" || error.kind === "timeout"
          ? "unreachable"
          : "provider";
    // The stored detail is shown on the card: the generic sentence, never a status or a host.
    return { code, detail: paperlessPublicMessage(error) };
  }
  return { code: "failed", detail: paperlessPublicMessage(error) };
}

/**
 * Stores the Paperless URL, the token of its read-only user and which document types to read.
 * Saving and proving are separate, as for Wallet and Trek: "Test connection" is the one that asks.
 */
export async function connectPaperlessAction(input: {
  baseUrl: string;
  token: string;
  payslipType: string;
  cometaOperationsType: string;
  cometaPositionType: string;
}): Promise<IntegrationActionResult> {
  const ctx = await requireSession();
  const url = normalizeBaseUrl(input.baseUrl);
  const token = input.token.trim();
  if (!url || token === "") return { ok: false, error: "empty" };
  if (!originAllowed(url, readEnv().PAPERLESS_ALLOWED_ORIGINS)) return { ok: false, error: "notAllowed" };
  if (!isUsableToken(token)) return { ok: false, error: "rejected" };
  const credentials: Record<string, string> = { baseUrl: url, token };
  const types = {
    [TYPE_KEYS.payslip]: input.payslipType.trim() || DEFAULT_PAYSLIP_TYPE,
    [TYPE_KEYS.cometa_operations]: input.cometaOperationsType.trim(),
    [TYPE_KEYS.cometa_position]: input.cometaPositionType.trim(),
  };
  for (const [key, value] of Object.entries(types)) {
    if (value === "") continue;
    if (value.length > 128) return { ok: false, error: "types" };
    credentials[key] = value;
  }
  try {
    await saveConnection(ctx, { provider: PAPERLESS_PROVIDER, credentials });
  } catch (error) {
    if (error instanceof IntegrationError) return { ok: false, error: "failed" };
    throw error;
  }
  revalidate();
  return { ok: true };
}

/** Asks Paperless for its document types: proves the token and that the named types exist. */
export async function testPaperlessAction(): Promise<IntegrationActionResult> {
  const ctx = await requireSession();
  const connection = await paperlessConnectionOf(ctx);
  if (!connection) return { ok: false, error: "notConnected" };
  try {
    const { client, credentials } = await paperlessClientOf(ctx, connection.id);
    const { missing } = resolveTypes(credentials, await client.documentTypes());
    if (missing.length > 0) {
      await markConnection(
        ctx,
        connection.id,
        "error",
        `Paperless has no document type named ${missing.join(", ")}`,
      );
      revalidate();
      return { ok: false, error: "types" };
    }
  } catch (error) {
    const { code, detail } = paperlessFailure(error);
    await markConnection(ctx, connection.id, code === "rejected" ? "revoked" : "error", detail);
    revalidate();
    return { ok: false, error: code };
  }
  await markConnection(ctx, connection.id, "active");
  revalidate();
  return { ok: true };
}

/** "Sync now" for Paperless. Does not move the schedule's next pass (D7). */
export async function syncPaperlessNowAction(): Promise<IntegrationActionResult> {
  const ctx = await requireSession();
  const connection = await paperlessConnectionOf(ctx);
  if (!connection) return { ok: false, error: "notConnected" };
  try {
    await syncPaperlessNow(ctx);
  } catch (error) {
    revalidate();
    if (isPaperlessBusy(error)) return { ok: false, error: "busy" };
    return { ok: false, error: paperlessFailure(error).code };
  }
  revalidate();
  revalidatePath("/payroll");
  return { ok: true };
}

/** Drops the Paperless link. The documents already imported stay, as the confirmation says. */
export async function disconnectPaperlessAction(): Promise<IntegrationActionResult> {
  const ctx = await requireSession();
  const connection = await paperlessConnectionOf(ctx);
  if (!connection) return { ok: false, error: "notConnected" };
  try {
    await deleteConnection(ctx, connection.id);
  } catch (error) {
    if (error instanceof IntegrationError) {
      return { ok: false, error: error.code === "not_found" ? "notConnected" : "failed" };
    }
    throw error;
  }
  revalidate();
  return { ok: true };
}

/* The schedule of any connection (D7) */

/** Saves when one of the person's own connections syncs; the provider names which one. */
export async function saveScheduleAction(
  provider: string,
  schedule: unknown,
): Promise<IntegrationActionResult> {
  const ctx = await requireSession();
  if (!isKnownProvider(provider)) return { ok: false, error: "notConnected" };
  const connection = (await listConnections(ctx)).find((one) => one.provider === provider);
  if (!connection) return { ok: false, error: "notConnected" };
  try {
    await saveSchedule(ctx, connection.id, schedule);
  } catch (error) {
    if (error instanceof IntegrationError) return { ok: false, error: "schedule" };
    throw error;
  }
  revalidate();
  return { ok: true };
}
