// src/app/(app)/settings/integrations/connection-calls.ts — what the row of a connection does, through
// `/api/v1/connections` (rewrite plan R3). It answers codes of the contract's closed list
// (CONNECTION_REFUSALS) and the words of the connection: the row turns them into its sentences.
import { connections } from "@ledgerly/api-contract/settings";
import { ApiError, call } from "@ledgerly/api-client";
import { invalidate, read } from "@ledgerly/ui/data";
import { coreConnectionAction } from "./actions";
import { answered } from "./connection-codes";

const KINDS = ["update", "resume", "enable", "test", "history"] as const;
type ConnectionKind = (typeof KINDS)[number];

export const isConnectionKind = (kind: string): kind is ConnectionKind => KINDS.some((one) => one === kind);

/** The words of a connection in a toast or a refusal: `name`, and `provider` as a person calls it. */
type Names = { name: string; provider: string };

type ConnectionCallResult = { ok: true; names: Names } | { ok: false; refusal: string; names: Names | null };

function send(connectionId: string, kind: ConnectionKind, months: number | undefined): Promise<unknown> {
  const params = { id: connectionId };
  if (kind === "history") return call(connections.rereadHistory, { params, body: { months: months ?? 0 } });
  if (kind === "update") return call(connections.syncNow, { params });
  if (kind === "resume") return call(connections.resumeConnection, { params });
  if (kind === "enable") return call(connections.enableConnection, { params });
  return call(connections.testConnection, { params });
}

/** The refusal of a route, or of the card of a provider of the core ("test" and "history" until R5c). */
async function refusalOf(
  error: unknown,
  provider: string,
  kind: ConnectionKind,
  months: number | undefined,
): Promise<string | null> {
  if (!(error instanceof ApiError)) throw error;
  if (error.reason !== "core_provider" || (kind !== "test" && kind !== "history"))
    return error.reason ?? "failed";
  const code = answered(await coreConnectionAction(provider, kind, months));
  return code === "notActive" ? "not_active" : code;
}

/** Does one thing to one of the person's connections; another person's id is not found. */
export async function runConnectionCall(
  connectionId: string,
  kind: ConnectionKind,
  /** For "history": how many months back the provider is read again. */
  months?: number,
): Promise<ConnectionCallResult> {
  const connection = (await read(connections.listConnections, {})).connections.find(
    (one) => one.id === connectionId,
  );
  if (!connection) return { ok: false, refusal: "failed", names: null };
  const names = { name: connection.name, provider: connection.providerName };
  let refusal: string | null = null;
  try {
    await send(connectionId, kind, months);
  } catch (error) {
    refusal = await refusalOf(error, connection.provider, kind, months);
  }
  if (kind !== "update") invalidate(connections.listConnections);
  return refusal === null ? { ok: true, names } : { ok: false, refusal, names };
}
