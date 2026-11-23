import { z } from "zod";
import { type CivilDate, addDays } from "../../../shared/dates";
import { DAY_FRACTIONS, LEAVE_DAY_KINDS } from "./days";
import { civilDate } from "../../../shared/inputs";

/* What a caller may state */

const MAX_NOTE = 200;

/**
 * An allowance for one year, as the modal states it: only what an employer grants.
 *
 * What last year left over is **not** here any more (N9). It was asked for twice — once of the
 * person and once of the payslip, which prints it as A.P. — and the two could disagree with no way
 * to tell which was right. The payslip is the employer's own figure, so the payslip keeps it.
 *
 * ROL is stated in days like everything else since N9. A contract usually says hours, but the
 * whole screen counts in days, and a field in a unit nothing else uses is a field people convert
 * in their head and get wrong.
 */
export const allowanceInputSchema = z.object({
  vacationDays: z.number().min(0).max(400).nullable().default(null),
  rolDays: z.number().min(0).max(400).nullable().default(null),
  /** Vacation and ROL together, as the contract states it (N7); `null` when nobody has. */
  totalDays: z.number().min(0).max(400).nullable().default(null),
  note: z.string().trim().max(MAX_NOTE).nullish().default(null),
});
export type AllowanceInput = z.input<typeof allowanceInputSchema>;

/**
 * Whether the two parts of an allowance add up to the total the contract states (N7).
 *
 * `null` when there is nothing to compare — no total stated, or a part missing. Otherwise the
 * difference in days, positive when the parts come to more than the total. The screen reports it
 * rather than correcting either figure: both are things a person typed off a contract, and which
 * one is wrong is not the app's to decide.
 */
export function allowanceMismatchDays(input: {
  totalDays: number | null;
  vacationDays: number | null;
  rolDays: number | null;
}): number | null {
  const { totalDays, vacationDays, rolDays } = input;
  if (totalDays === null || vacationDays === null || rolDays === null) return null;
  const difference = vacationDays + rolDays - totalDays;
  // A tenth of a day is rounding between two units, not a disagreement worth a sentence.
  return Math.abs(difference) < 0.1 ? null : difference;
}

/**
 * A day off, or a run of them: `to` left out means the single day `from`. One unit for every kind
 * since N0 — half a day or a whole one — so there is no longer a pair of fields to state
 * inconsistently.
 */
export const leaveInputSchema = z
  .object({
    from: civilDate("not a civil date"),
    to: civilDate("not a civil date").nullish().default(null),
    kind: z.enum(LEAVE_DAY_KINDS),
    fraction: z.number().nullish().default(null),
    note: z.string().trim().max(MAX_NOTE).nullish().default(null),
  })
  .refine((input) => input.to === null || input.to === undefined || input.to >= input.from, {
    path: ["to"],
    message: "range ends before it begins",
  })
  .refine((input) => (DAY_FRACTIONS as readonly number[]).includes(input.fraction ?? 1), {
    path: ["fraction"],
    message: "a day off is half a day or a whole one",
  });
export type LeaveInput = z.input<typeof leaveInputSchema>;

/** The leave panel's fields as a caller states them: both ends, always (rewrite plan N5). */
export const leaveRangeInputSchema = z
  .object({
    from: civilDate("not a civil date"),
    to: civilDate("not a civil date"),
    kind: z.enum(LEAVE_DAY_KINDS),
    fraction: z.number().refine((value) => (DAY_FRACTIONS as readonly number[]).includes(value)),
    note: z.string().trim().max(MAX_NOTE).nullish().default(null),
    editedKind: z.enum(LEAVE_DAY_KINDS).nullish().default(null),
    /** The kind of the second half of every day: half `kind` and half this (decision of 17/11/2026). */
    otherKind: z.enum(LEAVE_DAY_KINDS).nullish().default(null),
  })
  .refine((input) => input.to >= input.from, { path: ["to"], message: "range ends before it begins" })
  .refine(
    (input) =>
      input.otherKind === null ||
      input.otherKind === undefined ||
      (input.fraction === 0.5 && input.otherKind !== input.kind),
    { path: ["otherKind"], message: "a split day is two halves of two kinds" },
  )
  // An edit is of the one day its row stands for.
  .refine((input) => input.editedKind === null || input.editedKind === undefined || input.to === input.from, {
    path: ["to"],
    message: "an edit touches one day",
  });
export type LeaveRangeFields = z.input<typeof leaveRangeInputSchema>;

/** The two ends of a range whose leave goes, all of it ("Remove N days", N5 §7.5). */
export const leaveRemovalRangeSchema = z
  .object({ from: civilDate("not a civil date"), to: civilDate("not a civil date") })
  .refine((input) => input.to >= input.from, { path: ["to"], message: "range ends before it begins" });

/**
 * What some days held before a write, as "Undo" hands it back: the dates that were touched and the
 * rows they carried. Only what a person stated — kind, size, note — and nothing of what the calendar was
 * observed holding: that stays in the database, where a caller cannot restate it.
 */
export const leaveUndoSchema = z
  .object({
    dates: z.array(civilDate("not a civil date")).min(1).max(366),
    rows: z
      .array(
        z.object({
          on: civilDate("not a civil date"),
          kind: z.enum(LEAVE_DAY_KINDS),
          fraction: z.number().refine((value) => (DAY_FRACTIONS as readonly number[]).includes(value)),
          note: z.string().trim().max(MAX_NOTE).nullable(),
        }),
      )
      .max(366 * LEAVE_DAY_KINDS.length),
  })
  .refine((undo) => undo.rows.every((row) => undo.dates.includes(row.on)), {
    path: ["rows"],
    message: "a row of a date that was not touched",
  });
export type LeaveUndo = z.infer<typeof leaveUndoSchema>;

/** How many days one range may span: a year of working days, and no more. */
export const MAX_RANGE_DAYS = 260;

/** Every civil date of a closed range, ends included. */
export function datesBetween(from: CivilDate, to: CivilDate): CivilDate[] {
  const dates: CivilDate[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}
