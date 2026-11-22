// The card of Wallet (spec §9.1, F2.5, PERS-419): what `settings/integrations/actions.ts` did by Server
// Action, for the person of `ctx`. `/api/v1` and the actions reach it by the provider's id (`CoreCard`).
import type { Ctx } from "../../context";
import type { CardError, CoreCard } from "../card";
import { IntegrationError, markConnection, readCredentials, saveConnection } from "../service";
import type { Connection } from "../service";
import { WALLET_PROVIDER } from "../rules";
import { createWalletClient, isTokenRejected, isUsableToken, WalletError } from "./client";
import { BACKFILL_CHOICES } from "./depth";
import {
  chooseWalletAccounts,
  isSyncBusy,
  requestWalletBackfill,
  syncWalletNow,
  walletAccountChoices,
} from "./sync";

/**
 * A Wallet failure as the card names it, and as the connection records it: a refused token is a
 * fact about the credential (`revoked`), anything else is a bad afternoon (`error`). Only a real
 * connectivity failure is reported as one: a provider that answered is a different sentence.
 */
function walletFailure(error: unknown): { code: CardError; detail: string } {
  if (error instanceof WalletError) {
    const code: CardError = isTokenRejected(error)
      ? "rejected"
      : error.kind === "network" || error.kind === "timeout"
        ? "unreachable"
        : "provider";
    return { code, detail: error.message };
  }
  return { code: "failed", detail: error instanceof Error ? error.message : "unknown error" };
}

/** A refusal of the connection's own rows: gone, or failed; anything else is Wallet's. */
function refusalOf(error: unknown): { ok: false; error: CardError } {
  if (error instanceof IntegrationError) {
    return { ok: false, error: error.code === "not_found" ? "notConnected" : "failed" };
  }
  return { ok: false, error: walletFailure(error).code };
}

/**
 * Proves the stored token with a real read (spec §9.1), outside any transaction (spec §4.3): the token
 * goes from `readCredentials` straight into the client and is not logged, returned or stored.
 */
async function test(ctx: Ctx, connection: Connection) {
  const { token } = await readCredentials(ctx, connection.id);
  try {
    await createWalletClient(token).accounts();
  } catch (error) {
    const { code, detail } = walletFailure(error);
    await markConnection(ctx, connection.id, code === "rejected" ? "revoked" : "error", detail);
    return { ok: false as const, error: code };
  }
  await markConnection(ctx, connection.id, "active");
  return { ok: true as const };
}

/** «Sync now» (spec §10.3): a pass already running for this connection is `busy`, never doubled. */
async function sync(ctx: Ctx, connection: Connection) {
  try {
    await syncWalletNow(ctx, connection.id);
    return { ok: true as const };
  } catch (error) {
    if (isSyncBusy(error)) return { ok: false as const, error: "busy" as const };
    return refusalOf(error);
  }
}

export const walletCard: CoreCard = {
  provider: WALLET_PROVIDER,
  credentials(input) {
    const token = (input.token ?? "").trim();
    if (token.length === 0) return { ok: false, error: "empty" };
    // A token that cannot be an HTTP header value can never authenticate: refused, never kept (undici
    // would quote it into an error, a log and this card).
    if (!isUsableToken(token)) return { ok: false, error: "rejected" };
    return { ok: true, credentials: { token } };
  },
  save: (ctx, credentials) => saveConnection(ctx, { provider: WALLET_PROVIDER, credentials }),
  saveRefused: "failed",
  test,
  sync,
  async history(ctx, connection, months) {
    // Only the depths the card offers: the number comes from the browser.
    if (!BACKFILL_CHOICES.some((choice) => choice === months)) return { ok: false, error: "failed" };
    await requestWalletBackfill(ctx, connection.id, months);
    return { ok: true };
  },
  async accounts(ctx, connection) {
    try {
      const choices = await walletAccountChoices(ctx, connection.id);
      return {
        ok: true,
        accounts: choices.map((choice) => ({
          externalId: choice.externalId,
          name: choice.name,
          here: choice.local?.name ?? null,
          chosen: choice.chosen,
        })),
      };
    } catch (error) {
      return refusalOf(error);
    }
  },
  async choose(ctx, connection, chosen) {
    try {
      return { ok: true, ...(await chooseWalletAccounts(ctx, connection.id, [...chosen])) };
    } catch (error) {
      return refusalOf(error);
    }
  },
};
