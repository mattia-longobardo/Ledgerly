// The card of a source read with a token (spec §9.1, F2.5, PERS-419): what the Settings page did by
// Server Action, for the person of `ctx`. `/api/v1` reaches it by the provider's capabilities.
import type { PluginManifest } from "@ledgerly/plugin-contract";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { type Connection, IntegrationError } from "@ledgerly/domain/platform/integrations";
import { cardBase, type CardError, type PluginCard, proveCredential } from "../card";
import { chooseSourceAccounts, sourceAccountChoices } from "./accounts";
import { callCode, isTokenRefused, connectionSource } from "./calls";
import { requestSourceBackfill } from "./cursor";
import { BACKFILL_CHOICES } from "./depth";
import { isSyncBusy, syncSourceNow } from "./sync";

/** The codes of a call that did not reach the source, or a source that did not answer (contract 2). */
const UNREACHABLE = new Set(["provider_down", "plugin_down"]);

/**
 * A failure of the plugin's call as the card names it, and as the connection records it: a refused
 * token is a fact about the credential (`revoked`), anything else is a bad afternoon (`error`).
 * The detail is the call's code: the plugin never passes the source's own words on.
 */
function sourceFailure(error: unknown): { code: CardError; detail: string } {
  const code = callCode(error);
  if (code === null || error instanceof IntegrationError) {
    return { code: "failed", detail: error instanceof Error ? error.message : "unknown error" };
  }
  const named: CardError = isTokenRefused(error)
    ? "rejected"
    : UNREACHABLE.has(code)
      ? "unreachable"
      : "provider";
  return { code: named, detail: code };
}

/** A refusal of the connection's own rows: gone, or failed; anything else is the source's. */
function refusalOf(error: unknown): { ok: false; error: CardError } {
  if (error instanceof IntegrationError) {
    return { ok: false, error: error.code === "not_found" ? "notConnected" : "failed" };
  }
  return { ok: false, error: sourceFailure(error).code };
}

/** Proves the stored token with a real read (spec §9.1). */
const test = (ctx: Ctx, connection: Connection) =>
  proveCredential(ctx, connection, {
    ask: async () => (await connectionSource(ctx, connection)).accounts(),
    failure: sourceFailure,
  });

/** «Sync now» (spec §10.3): a pass already running for this connection is `busy`, never doubled. */
async function sync(ctx: Ctx, connection: Connection) {
  try {
    await syncSourceNow(ctx, connection.id);
    return { ok: true as const };
  } catch (error) {
    if (isSyncBusy(error)) return { ok: false as const, error: "busy" as const };
    return refusalOf(error);
  }
}

/** «Choose the accounts»: the accounts the source has now. */
async function accounts(ctx: Ctx, connection: Connection) {
  try {
    const choices = await sourceAccountChoices(ctx, connection.id);
    return {
      ok: true as const,
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
}

/** The card of the source of `provider`, its credential as its manifest describes it. */
export function sourceCard(provider: string, manifest: Pick<PluginManifest, "userSettings">): PluginCard {
  return {
    ...cardBase(provider, manifest),
    reads: "movements",
    saveRefused: "failed",
    test,
    sync,
    async history(ctx, connection, months) {
      // Only the depths the card offers: the number comes from the browser.
      if (!BACKFILL_CHOICES.some((choice) => choice === months)) return { ok: false, error: "failed" };
      await requestSourceBackfill(ctx, connection.id, months);
      return { ok: true };
    },
    accounts,
    async choose(ctx, connection, chosen) {
      try {
        return { ok: true, ...(await chooseSourceAccounts(ctx, connection.id, [...chosen])) };
      } catch (error) {
        return refusalOf(error);
      }
    },
  };
}
