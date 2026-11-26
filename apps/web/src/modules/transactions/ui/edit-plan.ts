/**
 * The edit dialog's rules, without React: which types a movement may take, and the writes one save
 * makes. A movement's type is a fact of its sign (the server's `macrosFor`): money out is a spending
 * or a giroconto, money in an income or a giroconto. The amount comes from the bank, so the dialog
 * never offers the type the sign rules out; a movement edited at its source is the exception, as the
 * source decides the sign from the type.
 */

import type { TransferSide } from "./commands";
import type { RowView } from "./view";

export type EditKind = "expense" | "income" | "transfer";

/** The other side of a giroconto as the dialog's select holds it: an account's id, or one of these. */
export const OUTSIDE = "outside";
export const NONE = "none";

type PlanRow = Pick<RowView, "transfer" | "macros" | "atSource" | "categoryId">;

/** Money out of the account. A giroconto says it; any other movement's macro is its sign. */
export function isOut(row: Pick<RowView, "transfer" | "macros">): boolean {
  return row.transfer ? row.transfer.out : row.macros?.[0] !== "income";
}

export function kindOf(row: PlanRow): EditKind {
  if (row.transfer) return "transfer";
  return row.atSource?.type ?? (isOut(row) ? "expense" : "income");
}

/** Whether the movement may become `kind`; a giroconto always may. */
export function allows(row: PlanRow, kind: EditKind): boolean {
  if (kind === "transfer" || row.atSource) return true;
  return isOut(row) === (kind === "expense");
}

/** The select's value for the giroconto's other side as it is now: `""` when nobody chose it yet. */
export function sideOf(row: Pick<RowView, "transfer">): string {
  const transfer = row.transfer;
  if (!transfer) return "";
  return transfer.state === "outside" ? OUTSIDE : (transfer.otherId ?? "");
}

export function sideFrom(value: string): TransferSide {
  if (value === OUTSIDE) return { kind: "outside" };
  if (value === NONE) return { kind: "none" };
  return { kind: "account", accountId: value };
}

interface TypeChoice {
  kind: EditKind;
  /** The category of a spending or an income; ignored for a giroconto. */
  categoryId: string | null;
  /** The other side of a giroconto (an account's id or {@link OUTSIDE}); ignored otherwise. */
  side: string;
}

export type TypeStep =
  { write: "side"; side: TransferSide } | { write: "category"; categoryId: string | null };

/**
 * The writes that take the movement to `choice`, in order, with the routes of today: a giroconto
 * becomes a spending or an income first (`none`: the server takes the type from the sign), and then
 * gets its category, since a giroconto refuses one. Nothing is written for what did not change.
 */
export function typeSteps(row: PlanRow, choice: TypeChoice): TypeStep[] {
  if (choice.kind === "transfer") {
    if (choice.side === "" || (row.transfer && choice.side === sideOf(row))) return [];
    return [{ write: "side", side: sideFrom(choice.side) }];
  }
  const steps: TypeStep[] = row.transfer ? [{ write: "side", side: { kind: "none" } }] : [];
  const current = row.transfer ? null : row.categoryId;
  if (choice.categoryId !== current) steps.push({ write: "category", categoryId: choice.categoryId });
  return steps;
}

/** What the dialog holds when Save is pressed. */
export interface EditForm extends TypeChoice {
  note: string;
  labelIds: readonly string[];
  /** The fields of a movement edited at its source; empty on any other. */
  amount: string;
  payee: string;
}

/** Every write of one save: `null` where the field did not change, so nothing claims it. */
export interface EditPlan {
  source: { type: EditKind; amount: string; payee: string; note: string } | null;
  steps: TypeStep[];
  note: string | null;
  labelIds: readonly string[] | null;
}

function sameLabels(current: readonly string[], next: readonly string[]): boolean {
  if (current.length !== next.length) return false;
  const mine = new Set(current);
  return next.every((one) => mine.has(one));
}

type FormRow = PlanRow & Pick<RowView, "note" | "payee" | "labelIds">;

/** Type, amount, payee and note go to the source first, when it takes them (owner, 2026-09-24). */
function sourceOf(row: FormRow, form: EditForm, noteChanged: boolean): EditPlan["source"] {
  const atSource = row.atSource;
  if (!atSource) return null;
  const changed =
    noteChanged ||
    form.kind !== atSource.type ||
    form.amount !== atSource.amount ||
    form.payee !== (row.payee ?? "");
  return changed ? { type: form.kind, amount: form.amount, payee: form.payee, note: form.note } : null;
}

export function planOf(row: FormRow, form: EditForm): EditPlan {
  const noteChanged = form.note !== (row.note ?? "");
  const source = sourceOf(row, form, noteChanged);
  return {
    source,
    steps: typeSteps(row, form),
    // A note saved at the source is saved here with it.
    note: noteChanged && source === null ? form.note : null,
    labelIds: sameLabels(row.labelIds, form.labelIds) ? null : form.labelIds,
  };
}

export function isEmpty(plan: EditPlan): boolean {
  return plan.source === null && plan.steps.length === 0 && plan.note === null && plan.labelIds === null;
}
