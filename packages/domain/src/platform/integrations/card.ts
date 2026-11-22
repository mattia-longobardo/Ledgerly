// What the card of a provider of the core does (spec §9.1, §9.2), by the provider's id: save the
// credential, prove it works, read now, read the history again, choose the accounts. Each provider says
// its own in its folder; `/api/v1` and the Server Actions reach a card by the provider's id, so no new
// file names a provider (rule M12, rewrite plan R5c anticipated).
import type { Ctx } from "../context";
import type { Connection } from "./service";

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

export interface CoreCard {
  provider: string;
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
