/**
 * A person's edit of a Wallet movement, written **to Wallet** (owner, 2026-09-24).
 *
 * Until now a movement's type, amount and payee belonged to the provider and could not be touched
 * here at all (spec §7.2), and its note was a local edit Wallet never heard of. With the Wallet
 * integration connected they can be changed from the Expenses screen, and the change goes to
 * Wallet first: only once Wallet has accepted it is it applied here, from the record Wallet
 * answers with, through the same merge a sync uses. The two sides never disagree about a value
 * this screen says was saved.
 *
 * The edit goes through the plugin (`POST /records/edit` of contract 2, rewrite plan R5c): it reads
 * the record, works out the patch Wallet can express (the sign of the amount, Wallet's built-in
 * Transfer category, `$clear` for an emptied text) and answers the record as Wallet holds it, or
 * why Wallet said no — a code, never Wallet's words.
 *
 * The network is used outside any transaction (spec §4.3): ask the plugin, then apply the answer
 * in the module's own short writes.
 */
import {
  type TransactionType,
  getTransaction,
  releaseLocalEdits,
  upsertFromProvider,
} from "../../../modules/transactions";
import type { Ctx } from "../../context";
import { type Cents, centsToDecimal } from "../../../shared/money";
import { WALLET_PROVIDER } from "../rules";
import { type Connection, externalIdsOf, listConnections } from "../service";
import { callCode, walletCalls } from "./calls";
import { syncWalletNow, toIncomingTransaction } from "./sync";

const TRANSACTION_ENTITY = "transaction";

/** What the Expenses screen submits: the whole of the editable movement, as it should now be. */
interface WalletRecordEdit {
  type: TransactionType;
  /** The size of the amount, always positive: the type decides the sign it reaches Wallet with. */
  amountCents: Cents;
  payee: string | null;
  note: string | null;
}

type WalletEditOutcome =
  | { state: "saved" }
  /** Everything submitted was already what Wallet holds: nothing was sent. */
  | { state: "unchanged" }
  /** No usable Wallet connection, or the movement did not come from Wallet. */
  | { state: "not_linked" }
  /** Wallet answered and refused the edit; `reason` is a code of contract 2 (`zero_amount`…). */
  | { state: "refused"; reason: string }
  /** The call never landed (the call's code), or Wallet has no such record any more (`gone`). */
  | { state: "failed"; reason: string };

/** A connection an edit may write through: one Wallet has not revoked. */
function usable(connection: Connection): boolean {
  return connection.provider === WALLET_PROVIDER && connection.state !== "revoked";
}

async function walletConnection(ctx: Pick<Ctx, "userId">): Promise<Connection | null> {
  return (await listConnections(ctx)).find(usable) ?? null;
}

/**
 * "Sync now" of the source a manual movement waits for, without a session (`retry_manual_send`):
 * `false` when `provider` is not Wallet or the person has no usable connection to it.
 */
export async function syncWalletFor(ctx: Ctx, provider: string): Promise<boolean> {
  if (provider !== WALLET_PROVIDER) return false;
  const connection = await walletConnection(ctx);
  if (!connection) return false;
  await syncWalletNow(ctx, connection.id);
  return true;
}

/**
 * The movements among `ids` that can be edited through Wallet: the integration is connected and
 * the movement came from it. Everything else keeps the local-only details panel.
 */
export async function walletEditableIds(
  ctx: Pick<Ctx, "userId">,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  if (!(await walletConnection(ctx))) return new Set();
  const linked = await externalIdsOf(ctx, WALLET_PROVIDER, TRANSACTION_ENTITY, ids);
  return new Set(linked.keys());
}

/** The fields of the movement a saved edit hands back to Wallet (see `releaseLocalEdits`). */
const PUSHED_FIELDS = ["amountCents", "type", "payee", "note"] as const;

/**
 * Writes a person's edit of one movement to Wallet, then here. Never throws for anything Wallet
 * does: a refusal, a network failure or a rejected token is an answer to show the person, and
 * nothing has been changed here in any of those cases.
 */
export async function editWalletTransaction(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  transactionId: string,
  edit: WalletRecordEdit,
): Promise<WalletEditOutcome> {
  const row = await getTransaction(ctx, transactionId);
  if (!row) return { state: "not_linked" };
  const externalId = (await externalIdsOf(ctx, WALLET_PROVIDER, TRANSACTION_ENTITY, [row.id])).get(row.id);
  if (!externalId) return { state: "not_linked" };
  const connection = await walletConnection(ctx);
  if (!connection) return { state: "not_linked" };

  let answer;
  try {
    const source = await walletCalls(ctx, connection.id);
    const size = edit.amountCents < 0n ? -edit.amountCents : edit.amountCents;
    answer = await source.edit({
      externalId,
      edit: { type: edit.type, amount: centsToDecimal(size), payee: edit.payee, note: edit.note },
    });
  } catch (error) {
    return { state: "failed", reason: callCode(error) ?? "failed" };
  }
  if (answer.state === "unchanged") return { state: "unchanged" };
  // A record Wallet no longer has is no refusal of the edit: there is nothing left to edit.
  if (answer.state === "refused") {
    return answer.reason === "gone" ? { state: "failed", reason: "gone" } : answer;
  }

  // Wallet holds the new values now: the fields follow it again, and its answer is applied the
  // way a sync would apply it. A missing answer leaves the row to the next pass, which reads it.
  await releaseLocalEdits(ctx, row.id, PUSHED_FIELDS);
  if (answer.movement) {
    await upsertFromProvider(
      ctx,
      row.accountId,
      [toIncomingTransaction(answer.movement, new Map(), ctx.timeZone)],
      { provider: WALLET_PROVIDER },
    );
  }
  return { state: "saved" };
}
