/**
 * The port of the Wallet engine (rewrite plan R5c, rule M8): what the engine asks of the source, in
 * the words of contract 2, declared here by the code that uses it. The realisation calls the
 * plugin `wallet` over HTTP (`openSource` of `@ledgerly/plugin-host`); only the application joins
 * the two (`wireDomain` of `apps/api`). The engine's decisions — which window, what is gone, which
 * category — stay here: the plugin only speaks to Wallet.
 */
import type { z } from "zod";
import type {
  EditResponse,
  editRequestSchema,
  PushResponse,
  pushRequestSchema,
  SourceAccountsResponse,
  SourceCategoriesResponse,
  SourceMovement,
  WriteCategoriesResponse,
  writeCategoriesRequestSchema,
} from "@ledgerly/plugin-contract";
import type { Ctx } from "../../context";
import { IntegrationError, readCredentials } from "../service";

export type SourceAccount = SourceAccountsResponse["accounts"][number];
export type SourceCategory = SourceCategoriesResponse["categories"][number];
type Request<T extends z.ZodType> = Omit<z.infer<T>, "credentials">;

/** The calls of contract 2 for one connection: its credentials are already in them. */
export interface SourceCalls {
  accounts(): Promise<SourceAccount[]>;
  categories(): Promise<SourceCategory[]>;
  movements(window: { from: string; to: string }): Promise<SourceMovement[]>;
  push(request: Request<typeof pushRequestSchema>): Promise<PushResponse>;
  edit(request: Request<typeof editRequestSchema>): Promise<EditResponse>;
  writeCategories(request: Request<typeof writeCategoriesRequestSchema>): Promise<WriteCategoriesResponse>;
}

/** The plugin that answers for Wallet. */
const PLUGIN_ID = "wallet";

interface Ports {
  /** The calls of a plugin, opened with one connection's credentials. */
  open(pluginId: string, credentials: Record<string, string>): SourceCalls;
}

// On `globalThis`, as the other ports: one process may load this file in more than one bundle.
declare global {
  var ledgerlySourcePorts: Ports | undefined;
}

/** Wires the port; the application calls it once per process, before any request or job. */
export function wireSource(ports: Ports): void {
  globalThis.ledgerlySourcePorts = ports;
}

/**
 * The calls of Wallet for one connection, with the token sealed in it. A token that is empty is the
 * connection's fault, not Wallet's: refused before anything is sent.
 */
export async function walletCalls(ctx: Pick<Ctx, "userId">, connectionId: string): Promise<SourceCalls> {
  const { token } = await readCredentials(ctx, connectionId);
  if (!token || token.trim() === "") throw new IntegrationError("invalid_credentials");
  const ports = globalThis.ledgerlySourcePorts;
  if (!ports) throw new Error("source: the ports are not wired (wireDomain of @ledgerly/api)");
  return ports.open(PLUGIN_ID, { token });
}

/** The code of a failure (`PluginCallError`, `IntegrationError`), never its words; `null` without one. */
export function callCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : null;
}

/**
 * Whether a failure says the token is refused: Wallet rejected it (`auth`), or it cannot be sent at
 * all (`key_format`).
 */
export function isTokenRefused(error: unknown): boolean {
  const code = callCode(error);
  return code === "auth" || code === "key_format";
}
