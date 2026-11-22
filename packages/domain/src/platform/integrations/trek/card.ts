// The card of Trek (spec §9.2, plan F7 L4): what `settings/integrations/actions.ts` did by Server
// Action, for the person of `ctx`. `/api/v1` and the actions reach it by the provider's id (`CoreCard`).
import type { Ctx } from "../../context";
import type { CardError, CoreCard } from "../card";
import { markConnection, readCredentials, saveConnection } from "../service";
import type { Connection } from "../service";
import { TREK_PROVIDER } from "../rules";
import { isUsableToken } from "../credentials";
import { createTrekClient, isTokenRejected, TrekError } from "./client";
import { isTrekBusy, syncTrekNow } from "./sync";

/** A Trek failure as the card names it: the credential refused, the network, or what Trek answered. */
function trekFailure(error: unknown): { code: CardError; detail: string } {
  if (error instanceof TrekError) {
    const code: CardError = isTokenRejected(error)
      ? "rejected"
      : error.kind === "network" || error.kind === "timeout"
        ? "unreachable"
        : "provider";
    return { code, detail: error.message };
  }
  return { code: "failed", detail: error instanceof Error ? error.message : "unknown error" };
}

/** Asks Trek for this year, which proves the token without writing anything. */
async function test(ctx: Ctx, connection: Connection) {
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
    return { ok: false as const, error: code };
  }
  await markConnection(ctx, connection.id, "active");
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
