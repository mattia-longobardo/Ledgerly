/**
 * The movement a person writes by hand (rewrite plan, 04-now.md §4.5): what the dialog may send
 * and the row it becomes. Pure: the account, the category and today's date are resolved by the
 * caller.
 */
import { z } from "zod";
import { type CivilDate, isCivilDate, wallClockIn } from "../../platform/dates";
import type { Cents } from "../../platform/money";
import type { TransactionType } from "./rules";

/** A manual movement is money out or money in: a giroconto is two movements a provider pairs. */
export const MANUAL_KINDS = ["expense", "income"] as const satisfies readonly TransactionType[];
export type ManualKind = (typeof MANUAL_KINDS)[number];

export const MANUAL_PAYEE_MAX = 255;
export const MANUAL_NOTE_MAX = 2000;

/** Trimmed, and an empty text is no text at all (spec §4.3). */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((value) => {
      const trimmed = value?.trim() ?? "";
      return trimmed === "" ? null : trimmed;
    });

export const manualMovementSchema = z.object({
  kind: z.enum(MANUAL_KINDS),
  /** The size of the amount: the kind decides the sign. */
  amountCents: z.bigint().positive(),
  on: z.string().refine(isCivilDate),
  accountId: z.uuid(),
  categoryId: z.uuid().nullable(),
  payee: optionalText(MANUAL_PAYEE_MAX),
  note: optionalText(MANUAL_NOTE_MAX),
});
export type ManualMovementInput = z.infer<typeof manualMovementSchema>;

/** A person writes what has happened: no movement of a day that has not come. */
export function isAfterToday(on: CivilDate, today: CivilDate): boolean {
  return on > today;
}

/** The signed amount: money out is negative, as every stored expense is. */
export function signedAmount(kind: ManualKind, amountCents: Cents): Cents {
  return kind === "expense" ? -amountCents : amountCents;
}

/**
 * The moment of a movement that has only a day: noon of that day where the person lives, so the
 * day is the same one whichever zone reads it back.
 */
export function manualOccurredAt(on: CivilDate, timeZone: string): Date {
  return wallClockIn(on, 12 * 60, timeZone);
}

/** The columns of a manual movement, from what the dialog sent. */
export function manualColumns(input: ManualMovementInput, currency: string, timeZone: string) {
  return {
    accountId: input.accountId,
    occurredAt: manualOccurredAt(input.on, timeZone),
    amountCents: signedAmount(input.kind, input.amountCents),
    currency,
    type: input.kind,
    categoryId: input.categoryId,
    payee: input.payee,
    note: input.note,
  };
}
