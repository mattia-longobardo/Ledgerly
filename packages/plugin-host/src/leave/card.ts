// The card of a leave calendar (spec §9.2, plan F7 L4): what the Settings page did by Server Action,
// for the person of `ctx`. `/api/v1` reaches it by the provider's capabilities.
import type { PluginManifest } from "@ledgerly/plugin-contract";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { type Connection, IntegrationError } from "@ledgerly/domain/platform/integrations";
import { cardBase, type CardError, type PluginCard, proveCredential } from "../card";
import { connectionCalendar, failureCode, isClientRefused } from "./calls";
import { isCalendarBusy, syncCalendarNow } from "./sync";

/** The codes of a call that did not reach the calendar, or a calendar that did not answer (contract 2). */
const UNREACHABLE = new Set(["provider_down", "plugin_down", "rate_limited"]);

/**
 * A failure as the card names it, and as the connection records it: a refused credential is a fact
 * about the credential (`revoked`), anything else is a bad afternoon (`error`). The detail is the
 * call's code: the plugin never passes the calendar's own words on.
 */
function calendarFailure(error: unknown): { code: CardError; detail: string } {
  const code = failureCode(error);
  if (isClientRefused(error)) return { code: "rejected", detail: code ?? "auth" };
  if (code === null || error instanceof IntegrationError) {
    return { code: "failed", detail: error instanceof Error ? error.message : "unknown error" };
  }
  return { code: UNREACHABLE.has(code) ? "unreachable" : "provider", detail: code };
}

/**
 * Asks the calendar for this year through the plugin, which proves the credential without writing
 * anything, and what it may do. A credential that may only read is kept: its connection says
 * `read_only`, and the days written here stay pending until it may write (decision D5).
 */
const test = (ctx: Ctx, connection: Connection) =>
  proveCredential(ctx, connection, {
    ask: async () => (await connectionCalendar(ctx, connection)).verify(),
    failure: calendarFailure,
    readOnly: (access) => access === "read-only",
  });

/** The card of the calendar of `provider`, its credential as its manifest describes it. */
export function calendarCard(provider: string, manifest: Pick<PluginManifest, "userSettings">): PluginCard {
  return {
    ...cardBase(provider, manifest),
    reads: "leave",
    saveRefused: "provider",
    test,
    async sync(ctx) {
      try {
        await syncCalendarNow(ctx);
        return { ok: true };
      } catch (error) {
        if (isCalendarBusy(error)) return { ok: false, error: "busy" };
        return { ok: false, error: calendarFailure(error).code };
      }
    },
  };
}
