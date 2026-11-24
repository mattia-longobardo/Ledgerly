import { z } from "zod";
import { type CivilDate, addDays } from "../../../shared/dates";
import { DAY_FRACTIONS, LEAVE_COLORS, LEAVE_UNITS } from "./days";
import { civilDate } from "../../../shared/inputs";

/* What a caller may state */

const MAX_NOTE = 200;
const typeId = () => z.uuid("not a type of leave");
/** The length of a row in hours, in minutes: at least a minute, at most a day. */
const rowMinutes = () => z.number().int().min(1).max(1440).nullish().default(null);

/** What a year grants of one type, and the carry-over a person states when no payslip says it. */
export const allowanceInputSchema = z.object({
  days: z.number().min(0).max(400).nullable().default(null),
  carriedDays: z.number().min(-400).max(400).nullable().default(null),
});
export type AllowanceInput = z.input<typeof allowanceInputSchema>;

/** A type of leave as a person states it (R5g). */
export const leaveTypeInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.enum(LEAVE_COLORS),
  unit: z.enum(LEAVE_UNITS),
  hasAllowance: z.boolean(),
  toCalendar: z.boolean(),
});
export type LeaveTypeInput = z.input<typeof leaveTypeInputSchema>;

/** A day of the year the person does not work, every year. */
export const restDayInputSchema = z.object({
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  name: z.string().trim().min(1).max(60),
});
export type RestDayInput = z.input<typeof restDayInputSchema>;

/** The working week and the first month of the leave year. */
export const leaveSettingsInputSchema = z.object({
  yearStartMonth: z.number().int().min(1).max(12),
  workDays: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .max(7)
    .refine((days) => new Set(days).size === days.length, "a day of the week twice"),
});
export type LeaveSettingsInput = z.input<typeof leaveSettingsInputSchema>;

/**
 * A day off, or a run of them: `to` left out means the single day `from`. One unit for every kind
 * since N0 — half a day or a whole one — so there is no longer a pair of fields to state
 * inconsistently.
 */
export const leaveInputSchema = z
  .object({
    from: civilDate("not a civil date"),
    to: civilDate("not a civil date").nullish().default(null),
    typeId: typeId(),
    fraction: z.number().nullish().default(null),
    minutes: rowMinutes(),
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
    typeId: typeId(),
    fraction: z.number().refine((value) => (DAY_FRACTIONS as readonly number[]).includes(value)),
    minutes: rowMinutes(),
    note: z.string().trim().max(MAX_NOTE).nullish().default(null),
    editedTypeId: typeId().nullish().default(null),
    /** The type of the second half of every day: half `typeId` and half this (decision of 17/11/2026). */
    otherTypeId: typeId().nullish().default(null),
  })
  .refine((input) => input.to >= input.from, { path: ["to"], message: "range ends before it begins" })
  .refine(
    (input) =>
      input.otherTypeId === null ||
      input.otherTypeId === undefined ||
      (input.fraction === 0.5 && input.otherTypeId !== input.typeId),
    { path: ["otherTypeId"], message: "a split day is two halves of two types" },
  )
  // An edit is of the one day its row stands for.
  .refine(
    (input) => input.editedTypeId === null || input.editedTypeId === undefined || input.to === input.from,
    {
      path: ["to"],
      message: "an edit touches one day",
    },
  );
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
          typeId: typeId(),
          fraction: z.number().refine((value) => (DAY_FRACTIONS as readonly number[]).includes(value)),
          minutes: z.number().int().min(1).max(1440).nullish().default(null),
          note: z.string().trim().max(MAX_NOTE).nullable(),
        }),
      )
      .max(366 * 8),
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
