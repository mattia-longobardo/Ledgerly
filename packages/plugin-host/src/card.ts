// What the card of a plugin read by an engine of the core does (spec §9.1, §9.2; rewrite plan R5c):
// save the credential, prove it works, read now, read the history again, choose the accounts. The
// engine of a source and the one of a leave calendar each give theirs, for the connection's provider;
// `/api/v1` reaches a card by the provider's capabilities (`cardOf`), so no file names a provider
// (rule M12).
import type { PluginManifest } from "@ledgerly/plugin-contract";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { type Connection, markConnection, saveConnection } from "@ledgerly/domain/platform/integrations";
import { isUsableToken } from "./credentials";

/** Why a card refused, as one of the `settings.integrations.errors.*` keys: a code, never a sentence. */
export type CardError =
  "rejected" | "unreachable" | "provider" | "empty" | "notConnected" | "busy" | "failed";

export type CardResult = { ok: true } | { ok: false; error: CardError };

/** One account of the source on «Choose the accounts»: no id of an account here, only its name. */
export interface CardAccount {
  externalId: string;
  name: string;
  /** The name of the account here it arrives in; `null` when Ledgerly does not have it. */
  here: string | null;
  chosen: boolean;
}

export interface PluginCard {
  provider: string;
  /** The kinds its connections read: what joins modules after a reading or a disconnection. */
  reads: "movements" | "leave";
  /** The credential cleaned and checked before anything is saved, or the refusal. */
  credentials(
    input: Readonly<Record<string, string>>,
  ): { ok: true; credentials: Record<string, string> } | { ok: false; error: CardError };
  /** Seals the credential checked by `credentials` into the person's connection. */
  save(ctx: Ctx, credentials: Record<string, string>): Promise<Connection>;
  /** What the card says when the credential cannot be saved (`save` threw an `IntegrationError`). */
  saveRefused: CardError;
  /** Asks the provider whether the saved credential works, and records the verdict. */
  test(ctx: Ctx, connection: Connection): Promise<CardResult>;
  /** Reads the provider now, as «Sync now». */
  sync(ctx: Ctx, connection: Connection): Promise<CardResult>;
  /** Asks for `months` of history at the next reading; only a provider that reads a chosen depth. */
  history?(ctx: Ctx, connection: Connection, months: number): Promise<CardResult>;
  /** The accounts the provider has now; only a provider whose accounts are chosen. */
  accounts?(
    ctx: Ctx,
    connection: Connection,
  ): Promise<{ ok: true; accounts: CardAccount[] } | { ok: false; error: CardError }>;
  /** Saves which of them arrive here: how many came back. */
  choose?(
    ctx: Ctx,
    connection: Connection,
    chosen: readonly string[],
  ): Promise<{ ok: true; added: number } | { ok: false; error: CardError }>;
}

/**
 * The credential of a connection as the manifest's `userSettings` describe it (E5): every field
 * trimmed, a required one present, and a secret only what an HTTP header can carry — a value pasted
 * out of a wrapped page is refused, never kept (undici would quote it into an error, a log and this
 * card). Fields the manifest does not name are dropped.
 */
function checkCredentials(
  fields: PluginManifest["userSettings"],
  input: Readonly<Record<string, string>>,
): { ok: true; credentials: Record<string, string> } | { ok: false; error: CardError } {
  const credentials: Record<string, string> = {};
  for (const field of fields) {
    const value = (input[field.name] ?? "").trim();
    if (value === "") {
      if (field.required) return { ok: false, error: "empty" };
      continue;
    }
    if (field.type === "secret" && !isUsableToken(value)) return { ok: false, error: "rejected" };
    credentials[field.name] = value;
  }
  return { ok: true, credentials };
}

/** What every card of a plugin read by the core shares: its provider, its credential, how it is saved. */
export function cardBase(provider: string, manifest: Pick<PluginManifest, "userSettings">) {
  return {
    provider,
    credentials: (input: Readonly<Record<string, string>>) => checkCredentials(manifest.userSettings, input),
    save: (ctx: Ctx, credentials: Record<string, string>) => saveConnection(ctx, { provider, credentials }),
  };
}

/** How a card proves a credential: the call that asks, and how its answers are named. */
interface Proof<T> {
  ask: () => Promise<T>;
  failure: (error: unknown) => { code: CardError; detail: string };
  /** An answer that works but may only read: the connection says `read_only` (decision D5). */
  readOnly?: (answer: T) => boolean;
}

/**
 * Asks the provider whether the saved credential works, outside any transaction (spec §4.3), and
 * records the verdict: the credential goes from `readCredentials` straight into the plugin's call
 * and is not logged, returned or stored. A refused credential is `revoked`, any other failure an
 * `error` with the call's code; a credential that may only read is kept, and says `read_only`.
 */
export async function proveCredential<T>(
  ctx: Ctx,
  connection: Connection,
  proof: Proof<T>,
): Promise<CardResult> {
  let answer: T;
  try {
    answer = await proof.ask();
  } catch (error) {
    const { code, detail } = proof.failure(error);
    await markConnection(ctx, connection.id, code === "rejected" ? "revoked" : "error", detail);
    return { ok: false, error: code };
  }
  if (proof.readOnly?.(answer) === true) await markConnection(ctx, connection.id, "error", "read_only");
  else await markConnection(ctx, connection.id, "active");
  return { ok: true };
}
