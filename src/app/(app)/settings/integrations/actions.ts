// src/app/(app)/settings/integrations/actions.ts — Settings › Integrations, the Wallet link of
// spec §9.1: save the token, prove it works, sync on demand, disconnect.
//
// Every one of these is the *user's own* connection (spec §10.3: "Sync now" is per user). None of
// them takes a connection id from the browser — the id is resolved from the session, so a pasted
// uuid cannot point the action at someone else's row — and none of them returns a credential.
"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@/platform/context";
import { WALLET_PROVIDER } from "@/platform/integrations/rules";
import { syncWalletNow } from "@/platform/integrations/wallet/sync";
import {
  type Connection,
  deleteConnection,
  IntegrationError,
  listConnections,
  markConnection,
  readCredentials,
  saveConnection,
} from "@/platform/integrations/service";
import { createWalletClient, isTokenRejected, WalletError } from "@/platform/integrations/wallet/client";

/**
 * Why an action refused, as one of the `settings.integrations.errors.*` keys. A code, not a
 * sentence: the card turns it into a catalogued message, so no English text is built here.
 */
export type IntegrationActionError = "rejected" | "unreachable" | "empty" | "notConnected" | "failed";

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
    return { code: isTokenRejected(error) ? "rejected" : "unreachable", detail: error.message };
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
  } catch (error) {
    // A sync writes rows before it fails, and it records its own `sync_runs` entry either way, so
    // the log is refreshed on the way out of both branches.
    revalidate();
    if (error instanceof IntegrationError) {
      return { ok: false, error: error.code === "not_found" ? "notConnected" : "failed" };
    }
    return { ok: false, error: walletFailure(error).code };
  }
  revalidate();
  return { ok: true };
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
