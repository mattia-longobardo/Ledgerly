/**
 * The port of the leave engine (rewrite plan R5c, rule M8): what the engine asks of the external
 * calendar, in the words of contract 2, declared here by the code that uses it. The realisation
 * calls the plugin `trek` over HTTP (`openCalendar` of `@ledgerly/plugin-host`); only the
 * application joins the two (`wireDomain` of `apps/api`). The engine's decisions — which days the
 * calendar should hold, what is still owed, what was refused, the runs and the lock — stay here.
 */
import type { LeaveDay, LeaveFigures, LeaveWriteResponse } from "@ledgerly/plugin-contract";
import type { Ctx } from "../../context";
import { IntegrationError, readCredentials } from "../service";

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

/** The plugin that answers for Trek. */
const PLUGIN_ID = "trek";
/** The keys the core has always sealed for Trek, sent as they are: nothing is sealed again. */
const CREDENTIAL_KEYS = ["baseUrl", "clientId", "clientSecret"] as const;

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
 * The calls of Trek for one connection, with its machine client. A credential that is missing is
 * the connection's fault, not Trek's: refused before anything is sent.
 */
export async function trekCalls(ctx: Pick<Ctx, "userId">, connectionId: string): Promise<CalendarCalls> {
  const bag = await readCredentials(ctx, connectionId);
  const credentials: Record<string, string> = {};
  for (const key of CREDENTIAL_KEYS) {
    const value = bag[key]?.trim() ?? "";
    if (value === "") throw new IntegrationError("invalid_credentials");
    credentials[key] = value;
  }
  const open = globalThis.ledgerlyCalendarOpener;
  if (open === undefined) throw new Error("calendar: the ports are not wired (wireDomain of @ledgerly/api)");
  return open(PLUGIN_ID, credentials);
}

/** The code of a failure of a call (`PluginCallError`, `IntegrationError`), never its words. */
export function failureCode(error: unknown): string | null {
  const code: unknown = typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
  return typeof code === "string" ? code : null;
}

/** Whether a failure says the machine client is refused, cannot be sent, or was never saved whole. */
export function isClientRefused(error: unknown): boolean {
  const code = failureCode(error);
  return code === "auth" || code === "key_format" || code === "invalid_credentials";
}
