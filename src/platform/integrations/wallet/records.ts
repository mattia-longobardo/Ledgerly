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
 * What Wallet API 2.0.0 (`https://rest.budgetbakers.com/wallet/openapi`) lets an edit express, and
 * how each choice is made of it:
 *
 * - **amount** — `PATCH /records` `amount.value`, signed: negative is an expense, positive an
 *   income, and Wallet derives `recordType` from the sign. So *expense ⇄ income* is the sign of the
 *   amount and nothing else. Zero is refused by Wallet.
 * - **transfer** — a patch cannot make a record a transfer: `transfer` (with its `pairingMode`)
 *   exists on the create only. What it can do is file the record under Wallet's built-in Transfer
 *   category (`system_categories__transfer`), which is Wallet's own word for a giroconto and what
 *   the sync already reads as `transfer` (see `toIncomingTransaction`). Leaving a transfer is
 *   `$clear: ["transfer"]` for a record Wallet holds as one (Wallet then files it under Unknown),
 *   or `$clear: ["categoryId"]` for one that is only in the Transfer category.
 * - **note** and **payee** — `note` and `counterParty`, at most 255 characters; an empty one is
 *   `$clear`ed rather than sent as `""`.
 *
 * The network is used outside any transaction (spec §4.3): read the record, patch it, then apply
 * the answer in the module's own short writes.
 */
import "server-only";
import type { TransactionType } from "@/modules/transactions/rules";
import { displayPayee } from "@/modules/transactions/rules";
import { getTransaction } from "@/modules/transactions/queries";
import { releaseLocalEdits, upsertFromProvider } from "@/modules/transactions/service";
import type { Ctx } from "@/platform/context";
import type { Cents } from "@/platform/money";
import { WALLET_PROVIDER } from "../rules";
import { type Connection, externalIdsOf, listConnections, readCredentials } from "../service";
import {
  type WalletClient,
  type WalletClientOptions,
  type WalletRecordPatch,
  type WalletRecordView,
  createWalletClient,
} from "./client";
import { WALLET_TRANSFER_CATEGORY } from "./mapping";
import { toIncomingTransaction } from "./sync";

const TRANSACTION_ENTITY = "transaction";

/** `PatchRecordItem.note` and `.counterParty` both stop at 255 characters. */
export const WALLET_RECORD_TEXT_MAX = 255;

/** What the Expenses screen submits: the whole of the editable movement, as it should now be. */
export interface WalletRecordEdit {
  type: TransactionType;
  /** The size of the amount, always positive: the type decides the sign it reaches Wallet with. */
  amountCents: Cents;
  payee: string | null;
  note: string | null;
}

export type WalletEditOutcome =
  | { state: "saved" }
  /** Everything submitted was already what Wallet holds: nothing was sent. */
  | { state: "unchanged" }
  /** No usable Wallet connection, or the movement did not come from Wallet. */
  | { state: "not_linked" }
  /** Wallet answered and refused the edit; `reason` is Wallet's own words. */
  | { state: "refused"; reason: string }
  /** The call never landed, or Wallet has no such record any more. */
  | { state: "failed"; reason: string };

/** A connection an edit may write through: one Wallet has not revoked. */
function usable(connection: Connection): boolean {
  return connection.provider === WALLET_PROVIDER && connection.state !== "revoked";
}

async function walletConnection(ctx: Pick<Ctx, "userId">): Promise<Connection | null> {
  return (await listConnections(ctx)).find(usable) ?? null;
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

/** How Wallet itself would call the record today. */
function currentType(record: WalletRecordView): TransactionType {
  if (record.isTransfer || record.movement.categorySystemId === WALLET_TRANSFER_CATEGORY) return "transfer";
  return record.movement.amountCents < 0n ? "expense" : "income";
}

/** A text as Wallet should hold it: trimmed, and absent rather than blank. */
function cleanText(value: string | null): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

export class WalletEditError extends Error {
  constructor(readonly code: "no_transfer_category" | "zero_amount") {
    super(code);
    this.name = "WalletEditError";
  }
}

/**
 * The patch that turns `record` into `edit`, or `null` when they already agree. Pure: the one
 * decision of this file, and the part the tests hold to.
 *
 * A transfer keeps the direction it has in Wallet (money out stays out): the screen asks for the
 * size, and a giroconto's side is a fact about the two accounts, not something to re-decide here.
 */
export function planWalletRecordEdit(
  record: WalletRecordView,
  edit: WalletRecordEdit,
  transferCategoryId: string | null,
): WalletRecordPatch | null {
  const size = edit.amountCents < 0n ? -edit.amountCents : edit.amountCents;
  if (size === 0n) throw new WalletEditError("zero_amount");

  const patch: WalletRecordPatch = { id: record.movement.externalId };
  const clear: NonNullable<WalletRecordPatch["clear"]>[number][] = [];
  const was = currentType(record);

  const outgoing = edit.type === "expense" || (edit.type === "transfer" && record.movement.amountCents < 0n);
  const amountCents = outgoing ? -size : size;
  if (amountCents !== record.movement.amountCents) patch.amountCents = amountCents;

  const note = cleanText(edit.note);
  if (note !== cleanText(record.movement.note)) {
    if (note === null) clear.push("note");
    else patch.note = note;
  }
  const payee = cleanText(edit.payee);
  if (payee !== displayPayee(record.movement.payee)) {
    if (payee === null) clear.push("counterParty");
    else patch.counterParty = payee;
  }

  if (edit.type === "transfer" && was !== "transfer") {
    if (transferCategoryId === null) throw new WalletEditError("no_transfer_category");
    patch.categoryId = transferCategoryId;
  } else if (edit.type !== "transfer" && was === "transfer") {
    clear.push(record.isTransfer ? "transfer" : "categoryId");
  }

  if (clear.length > 0) patch.clear = clear;
  return Object.keys(patch).length > 1 ? patch : null;
}

/** The fields of the movement a saved edit hands back to Wallet (see `releaseLocalEdits`). */
const PUSHED_FIELDS = ["amountCents", "type", "payee", "note"] as const;

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Writes a person's edit of one movement to Wallet, then here. Never throws for anything Wallet
 * does: a refusal, a network failure or a rejected token is an answer to show the person, and
 * nothing has been changed here in any of those cases.
 */
export async function editWalletTransaction(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  transactionId: string,
  edit: WalletRecordEdit,
  deps: { client?: WalletClient; options?: WalletClientOptions } = {},
): Promise<WalletEditOutcome> {
  const row = await getTransaction(ctx, transactionId);
  if (!row) return { state: "not_linked" };
  const externalId = (await externalIdsOf(ctx, WALLET_PROVIDER, TRANSACTION_ENTITY, [row.id])).get(row.id);
  if (!externalId) return { state: "not_linked" };

  let client = deps.client;
  if (!client) {
    const connection = await walletConnection(ctx);
    if (!connection) return { state: "not_linked" };
    const { token } = await readCredentials(ctx, connection.id);
    if (!token || token.trim() === "") return { state: "failed", reason: "invalid_credentials" };
    client = createWalletClient(token, deps.options ?? {});
  }

  let saved: WalletRecordView | null;
  try {
    const record = await client.record(externalId);
    if (!record) return { state: "failed", reason: "Wallet has no record with this id any more" };
    const transferCategoryId =
      edit.type === "transfer" && currentType(record) !== "transfer"
        ? ((await client.categories()).find((one) => one.systemId === WALLET_TRANSFER_CATEGORY)?.externalId ??
          null)
        : null;
    const patch = planWalletRecordEdit(record, edit, transferCategoryId);
    if (patch === null) return { state: "unchanged" };
    const answer = await client.patchRecord(patch);
    if (!answer.ok) return { state: "refused", reason: answer.error };
    saved = answer.record ?? (await client.record(externalId));
  } catch (error) {
    if (error instanceof WalletEditError) return { state: "refused", reason: error.code };
    // `WalletError` messages are redacted by the client: the token is never in them.
    return { state: "failed", reason: reasonOf(error) };
  }

  // Wallet holds the new values now: the fields follow it again, and its answer is applied the
  // way a sync would apply it. A missing answer leaves the row to the next pass, which reads it.
  await releaseLocalEdits(ctx, row.id, PUSHED_FIELDS);
  if (saved) {
    await upsertFromProvider(ctx, row.accountId, [
      toIncomingTransaction(saved.movement, new Map(), ctx.timeZone),
    ]);
  }
  return { state: "saved" };
}
