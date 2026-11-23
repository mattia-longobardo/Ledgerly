/**
 * The calls the leave engine makes (rewrite plan R5c), in the words of contract 2, for one
 * connection: the plugin is the connection's own (`plugin:<id>`), with the capability
 * `leaveCalendar`, opened with its sealed credentials by `openCalendar`. The engine's decisions —
 * which days the calendar should hold, what is still owed, what was refused, the runs and the lock
 * — stay in this folder. No provider is named here (rule M12).
 */
import type { LeaveDay, LeaveFigures, LeaveWriteResponse } from "@ledgerly/plugin-contract";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { IntegrationError, readCredentials } from "@ledgerly/domain/platform/integrations";

/** One change the engine wants of a year: every day to hold, and the days to take away. */
interface LeaveWrite {
  year: number;
  desired: { day: string; fraction: 0.5 | 1; kind: string }[];
  remove: string[];
}

/** The calls of contract 2 for one connection: its credentials are already in them. */
export interface CalendarCalls {
  verify(): Promise<"read-only" | "write" | "unverifiable">;
  read(year: number): Promise<LeaveDay[]>;
  write(request: LeaveWrite): Promise<LeaveWriteResponse>;
  figures(year: number): Promise<LeaveFigures | null>;
}

/** Opens the calls of a plugin with one connection's credentials. */
type Opener = (pluginId: string, credentials: Record<string, string>) => CalendarCalls;

// On `globalThis`, as the other ports: one process may load this file in more than one bundle.
declare global {
  var ledgerlyCalendarOpener: Opener | undefined;
}

/** Wires the port; the application calls it once per process, before any request or job. */
export const wireCalendar = (ports: { open: Opener }): void => {
  globalThis.ledgerlyCalendarOpener = ports.open;
};

/**
 * The calls of the calendar of one connection, with its credentials sealed in them, as they were
 * saved: nothing is sealed again. A credential that is empty is the connection's fault, not the
 * calendar's: refused before anything is sent.
 */
export async function connectionCalendar(
  ctx: Pick<Ctx, "userId">,
  connection: { id: string; provider: string },
): Promise<CalendarCalls> {
  const bag = await readCredentials(ctx, connection.id);
  const credentials: Record<string, string> = {};
  for (const [key, raw] of Object.entries(bag)) {
    const value = raw.trim();
    if (value === "") throw new IntegrationError("invalid_credentials");
    credentials[key] = value;
  }
  if (Object.keys(credentials).length === 0) throw new IntegrationError("invalid_credentials");
  const open = globalThis.ledgerlyCalendarOpener;
  if (open === undefined) throw new Error("calendar: the ports are not wired (wireDomain of @ledgerly/api)");
  return open(connection.provider.slice("plugin:".length), credentials);
}

/** The code of a failure of a call (`PluginCallError`, `IntegrationError`), never its words. */
export function failureCode(error: unknown): string | null {
  const code: unknown = typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
  return typeof code === "string" ? code : null;
}

/** Whether a failure says the credential is refused, cannot be sent, or was never saved whole. */
export function isClientRefused(error: unknown): boolean {
  const code = failureCode(error);
  return code === "auth" || code === "key_format" || code === "invalid_credentials";
}
