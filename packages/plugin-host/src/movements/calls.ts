/**
 * The calls the engine of a source makes (rewrite plan R5c), in the words of contract 2, for one
 * connection: the plugin is the connection's own (`plugin:<id>`), opened with its sealed
 * credentials by `openSource`. The engine's decisions — which window, what is gone, which category
 * — stay in this folder: the plugin only speaks to the source. No provider is named here (rule M12).
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
import type { Ctx } from "@ledgerly/domain/platform/context";
import { IntegrationError, readCredentials } from "@ledgerly/domain/platform/integrations";

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

/** The plugin of a connection: `plugin:<id>` → `<id>`. */
function pluginIdOf(provider: string): string {
  return provider.slice("plugin:".length);
}

/**
 * The calls of the source of one connection, with its credentials sealed in them. A credential
 * that is empty is the connection's fault, not the source's: refused before anything is sent.
 */
export async function connectionSource(
  ctx: Pick<Ctx, "userId">,
  connection: { id: string; provider: string },
): Promise<SourceCalls> {
  const bag = await readCredentials(ctx, connection.id);
  const values = Object.values(bag);
  if (values.length === 0 || values.some((value) => value.trim() === "")) {
    throw new IntegrationError("invalid_credentials");
  }
  const ports = globalThis.ledgerlySourcePorts;
  if (!ports) throw new Error("source: the ports are not wired (wireDomain of @ledgerly/api)");
  return ports.open(pluginIdOf(connection.provider), bag);
}

/** The code of a failure (`PluginCallError`, `IntegrationError`), never its words; `null` without one. */
export function callCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : null;
}

/**
 * Whether a failure says the token is refused: the source rejected it (`auth`), or it cannot be sent
 * at all (`key_format`).
 */
export function isTokenRefused(error: unknown): boolean {
  const code = callCode(error);
  return code === "auth" || code === "key_format";
}
