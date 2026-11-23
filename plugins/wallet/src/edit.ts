/**
 * Edits of a Wallet record (`PATCH /records`, Wallet API 2.0.0), one attempt like every write: the
 * payee of a pushed movement, and a person's edit of a movement.
 *
 * What a patch can express, and how an edit is made of it:
 * - **amount** — signed: negative is an expense; Wallet derives `recordType` from the sign, so
 *   expense ⇄ income is the sign and nothing else. Zero is refused by Wallet.
 * - **transfer** — a patch cannot make a record a transfer (`transfer` exists on the create only):
 *   it files the record under Wallet's built-in Transfer category. Leaving a transfer is
 *   `$clear: ["transfer"]` for a record Wallet holds as one, `$clear: ["categoryId"]` for one only
 *   in the Transfer category.
 * - **note** and **payee** — `note` and `counterParty`; an empty one is cleared, never sent as "".
 */
import type { EditResponse } from "@ledgerly/plugin-contract";
import { readCategories } from "./categories";
import { WalletError } from "./failure";
import { type Wallet, write } from "./http";
import { centsToDecimal, parseCents } from "./money";
import { optionalText, patchedRecordsSchema } from "./payloads";
import { readRecord, type RecordView, recordView } from "./records";

type MovementType = "income" | "expense" | "transfer";
type Cleared = "note" | "counterParty" | "categoryId" | "transfer";

/** A patch in this plugin's words: only the keys present are sent. */
interface RecordPatch {
  id: string;
  cents?: bigint;
  note?: string;
  counterParty?: string;
  categoryId?: string;
  clear?: Cleared[];
}

/** The edit the core asks for: the size of the amount, and the type that decides its sign. */
interface RecordEdit {
  type: MovementType;
  amount: string;
  payee: string | null;
  note: string | null;
}

type Refusal = Extract<EditResponse, { state: "refused" }>["reason"];

/** The body of a one-item `PATCH /records`, the amount written as its exact decimal. */
function patchBody(patch: RecordPatch): string {
  const fields: string[] = [`"id":${JSON.stringify(patch.id)}`];
  if (patch.cents !== undefined) fields.push(`"amount":{"value":${centsToDecimal(patch.cents)}}`);
  if (patch.note !== undefined) fields.push(`"note":${JSON.stringify(patch.note)}`);
  if (patch.counterParty !== undefined) fields.push(`"counterParty":${JSON.stringify(patch.counterParty)}`);
  if (patch.categoryId !== undefined) fields.push(`"categoryId":${JSON.stringify(patch.categoryId)}`);
  if (patch.clear && patch.clear.length > 0) fields.push(`"$clear":${JSON.stringify(patch.clear)}`);
  return `[{${fields.join(",")}}]`;
}

/**
 * Patches one record. A 400, or a result that is not a success, is Wallet refusing this edit:
 * `{ saved: false }`. On success `record` is the record as Wallet now holds it, `null` when the
 * answer carried none.
 */
export async function patchRecord(
  wallet: Wallet,
  patch: RecordPatch,
): Promise<{ saved: true; record: RecordView | null } | { saved: false }> {
  let answer;
  try {
    answer = await write(
      wallet,
      { path: "/records", method: "PATCH", body: patchBody(patch) },
      patchedRecordsSchema,
    );
  } catch (error) {
    if (error instanceof WalletError && error.kind === "http" && error.status === 400)
      return { saved: false };
    throw error;
  }
  const result = answer.results.find((row) => row.inputIndex === 0) ?? answer.results[0];
  if (!result?.success) return { saved: false };
  return { saved: true, record: result.record ? recordView(result.record) : null };
}

/** How Wallet itself would call the record today. */
function currentType(record: RecordView): MovementType {
  if (record.isTransfer || record.movement.category?.transfer === true) return "transfer";
  return record.cents < 0n ? "expense" : "income";
}

/** The amount, note and payee half of a plan: what differs from what Wallet holds. */
function planValues(record: RecordView, edit: RecordEdit, size: bigint): RecordPatch {
  const patch: RecordPatch = { id: record.movement.externalId, clear: [] };
  const outgoing = edit.type === "expense" || (edit.type === "transfer" && record.cents < 0n);
  const cents = outgoing ? -size : size;
  if (cents !== record.cents) patch.cents = cents;
  const note = optionalText(edit.note);
  if (note !== optionalText(record.note)) {
    if (note === null) patch.clear?.push("note");
    else patch.note = note;
  }
  const payee = optionalText(edit.payee);
  if (payee !== record.movement.payee) {
    if (payee === null) patch.clear?.push("counterParty");
    else patch.counterParty = payee;
  }
  return patch;
}

/**
 * The patch that turns `record` into `edit`, `null` when they already agree, or the reason it
 * cannot be made. A transfer keeps the direction it has in Wallet (money out stays out): the
 * person gives the size, and a giroconto's side is a fact about the two accounts.
 */
export function planRecordEdit(
  record: RecordView,
  edit: RecordEdit,
  transferCategoryId: string | null,
): RecordPatch | null | Refusal {
  const size = parseCents(edit.amount);
  if (size === 0n) return "zero_amount";
  const patch = planValues(record, edit, size);
  const was = currentType(record);
  if (edit.type === "transfer" && was !== "transfer") {
    if (transferCategoryId === null) return "no_transfer_category";
    patch.categoryId = transferCategoryId;
  } else if (edit.type !== "transfer" && was === "transfer") {
    patch.clear?.push(record.isTransfer ? "transfer" : "categoryId");
  }
  if (patch.clear?.length === 0) delete patch.clear;
  return Object.keys(patch).length > 1 ? patch : null;
}

/** Wallet's Transfer category, looked up only when the edit makes a record a transfer. */
async function transferCategoryFor(
  wallet: Wallet,
  record: RecordView,
  edit: RecordEdit,
): Promise<string | null> {
  if (edit.type !== "transfer" || currentType(record) === "transfer") return null;
  return (await readCategories(wallet)).find((one) => one.transfer)?.externalId ?? null;
}

/** A person's edit of one record: read it, plan the patch, send it, and answer what Wallet holds. */
export async function editRecord(
  wallet: Wallet,
  externalId: string,
  edit: RecordEdit,
): Promise<EditResponse> {
  const record = await readRecord(wallet, externalId);
  if (record === null) return { state: "refused", reason: "gone" };
  const plan = planRecordEdit(record, edit, await transferCategoryFor(wallet, record, edit));
  if (plan === null) return { state: "unchanged" };
  if (typeof plan === "string") return { state: "refused", reason: plan };
  const answer = await patchRecord(wallet, plan);
  if (!answer.saved) return { state: "refused", reason: "provider_refused" };
  const saved = answer.record ?? (await readRecord(wallet, externalId));
  return { state: "saved", movement: saved?.movement ?? null };
}
