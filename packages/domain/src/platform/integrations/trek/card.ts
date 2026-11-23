// The card of Trek (spec §9.2, plan F7 L4): what `settings/integrations/actions.ts` did by Server
// Action, for the person of `ctx`. `/api/v1` and the actions reach it by the provider's id (`CoreCard`).
import type { Ctx } from "../../context";
import type { CardError, CoreCard } from "../card";
import { IntegrationError, markConnection, saveConnection } from "../service";
import type { Connection } from "../service";
import { TREK_PROVIDER } from "../rules";
import { isUsableToken } from "../credentials";
import { failureCode, isClientRefused, trekCalls } from "./calls";
import { isTrekBusy, syncTrekNow } from "./sync";

/** The codes of a call that did not reach Trek, or Trek that did not answer (contract 2). */
const UNREACHABLE = new Set(["provider_down", "plugin_down", "rate_limited"]);

/**
 * A failure as the card names it, and as the connection records it: a refused machine client is a
 * fact about the credential (`revoked`), anything else is a bad afternoon (`error`). The detail is
 * the call's code: the plugin never passes Trek's own words on.
 */
function trekFailure(error: unknown): { code: CardError; detail: string } {
  const code = failureCode(error);
  if (isClientRefused(error)) return { code: "rejected", detail: code ?? "auth" };
  if (code === null || error instanceof IntegrationError) {
    return { code: "failed", detail: error instanceof Error ? error.message : "unknown error" };
  }
  return { code: UNREACHABLE.has(code) ? "unreachable" : "provider", detail: code };
}

/**
 * Asks Trek for this year through the plugin, which proves the machine client without writing
 * anything, and what it may do. A client that may only read is kept: its connection says
 * `read_only`, and the days written here stay pending until it may write (decision D5).
 */
async function test(ctx: Ctx, connection: Connection) {
  let access: "read-only" | "write" | "unverifiable";
  try {
    access = await (await trekCalls(ctx, connection.id)).verify();
  } catch (error) {
    const { code, detail } = trekFailure(error);
    await markConnection(ctx, connection.id, code === "rejected" ? "revoked" : "error", detail);
    return { ok: false as const, error: code };
  }
  if (access === "read-only") await markConnection(ctx, connection.id, "error", "read_only");
  else await markConnection(ctx, connection.id, "active");
  return { ok: true as const };
}

export const trekCard: CoreCard = {
  provider: TREK_PROVIDER,
  credentials(input) {
    const url = (input.baseUrl ?? "").trim().replace(/\/+$/, "");
    const clientId = (input.clientId ?? "").trim();
    const clientSecret = (input.clientSecret ?? "").trim();
    if (url === "" || clientId === "" || clientSecret === "") return { ok: false, error: "empty" };
    // A header value is all either may be: a line break pasted out of a wrapped page would otherwise
    // be quoted verbatim into a log and a page.
    if (!isUsableToken(clientId) || !isUsableToken(clientSecret)) return { ok: false, error: "empty" };
    if (!/^https:\/\/[^\s]+$/.test(url)) return { ok: false, error: "provider" };
    return { ok: true, credentials: { baseUrl: url, clientId, clientSecret } };
  },
  save: (ctx, credentials) => saveConnection(ctx, { provider: TREK_PROVIDER, credentials }),
  saveRefused: "provider",
  test,
  async sync(ctx) {
    try {
      await syncTrekNow(ctx);
      return { ok: true };
    } catch (error) {
      if (isTrekBusy(error)) return { ok: false, error: "busy" };
      return { ok: false, error: trekFailure(error).code };
    }
  },
};
