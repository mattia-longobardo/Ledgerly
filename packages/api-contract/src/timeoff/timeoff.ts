// Time off (rewrite plan R2, 05-refactor.md §5.5 «timeoff»; audit TOF-4, TOF-5, TOF-7): the year of
// the Time off page as `get_time_off` shows it too, the allowances of Time off › Settings and the
// writes of the leave panel. A write answers what «Undo» sends back; the pass of the external
// calendar starts from the event `LeaveChanged`, the same for an action and a route.
import { z } from "zod";
import { defineRoute } from "../route";
import { civilDate } from "../primitives";
import {
  allowance,
  byDate,
  byDay,
  byYear,
  DAY_FRACTIONS,
  DAY_ID,
  LEAVE_KINDS,
  leaveUndo,
  MAX_NOTE,
  TIMEOFF_ERRORS,
  TIMEOFF_YEAR_EXAMPLE,
  timeOffYear,
  UNDO_EXAMPLE,
} from "./shared";

export const getTimeOff = defineRoute({
  id: "get_time_off",
  method: "GET",
  path: "/timeoff/{year}",
  scope: "read",
  capability: "timeoff",
  summary:
    "One year of time off: the residual of vacation and ROL with the formula that gave it, the year's " +
    "totals by month and kind, the days and the payslips' months, the forecasts and the warnings.",
  actions: [],
  params: byYear,
  response: timeOffYear,
  errors: ["invalid"],
  mcp: {
    title: "Time off",
    description:
      "One year of leave: what is left of vacation and ROL (and whether the payslip or the allowance " +
      "says so), days taken and planned by month and kind, the forecast at year end, overdrawn kinds " +
      "and months a payslip counted more leave than recorded. Lengths in minutes; minutesPerDay is a day.",
    arguments: {
      year: z
        .string()
        .regex(/^\d{4}$/)
        .describe("The year, YYYY."),
    },
    pathArguments: { year: "year" },
  },
  example: { params: { year: "2026" }, response: TIMEOFF_YEAR_EXAMPLE },
});

export const listTimeOffAllowances = defineRoute({
  id: "list_time_off_allowances",
  method: "GET",
  path: "/timeoff/allowances",
  scope: "read",
  capability: "timeoff",
  summary: "The allowance stated for each year, newest first.",
  actions: [],
  response: z.object({ allowances: z.array(allowance) }),
  errors: [],
  example: { response: { allowances: [TIMEOFF_YEAR_EXAMPLE.allowance] } },
});

const days = () => z.number().min(0).max(400).nullable();

export const saveTimeOffAllowance = defineRoute({
  id: "save_time_off_allowance",
  method: "PUT",
  path: "/timeoff/allowances/{year}",
  scope: "write",
  capability: "timeoff",
  summary: "States the allowance of a year, in days; null for a part nobody states.",
  actions: [],
  params: byYear,
  body: z
    .object({
      vacationDays: days(),
      rolDays: days(),
      totalDays: days(),
      note: z.string().max(MAX_NOTE).nullable(),
    })
    .strict(),
  response: allowance,
  errors: ["invalid"],
  example: {
    params: { year: "2026" },
    body: { vacationDays: 22, rolDays: 4, totalDays: 26, note: null },
    response: TIMEOFF_YEAR_EXAMPLE.allowance,
  },
});

const undoAnswer = z.object({
  undo: leaveUndo,
  /** The working days written. */
  days: z.number(),
  /** The rows removed, those still owed to the external calendar included. */
  removed: z.number().int(),
  /** Of `removed`, the ones the external calendar has not been told about yet. */
  pending: z.number().int(),
});

export const saveLeave = defineRoute({
  id: "save_leave",
  method: "POST",
  path: "/timeoff/leave",
  scope: "write",
  capability: "timeoff",
  summary:
    "Books a range of days, one kind and one size for every day; weekends and holidays are left out. " +
    "`editedKind` edits the row of one day; `otherKind` books «½ + ½». Answers what «Undo» sends back.",
  actions: [],
  body: z
    .object({
      from: civilDate(),
      to: civilDate(),
      kind: z.enum(LEAVE_KINDS),
      fraction: z.union(DAY_FRACTIONS.map((one) => z.literal(one))),
      note: z.string().max(MAX_NOTE).nullable(),
      editedKind: z.enum(LEAVE_KINDS).nullable(),
      otherKind: z.enum(LEAVE_KINDS).nullable(),
    })
    .strict(),
  response: undoAnswer,
  errors: TIMEOFF_ERRORS,
  example: {
    body: {
      from: "2026-08-10",
      to: "2026-08-10",
      kind: "vacation",
      fraction: 1,
      note: null,
      editedKind: null,
      otherKind: null,
    },
    response: { undo: { dates: ["2026-08-10"], rows: [] }, days: 1, removed: 0, pending: 0 },
  },
});

export const removeLeaveDay = defineRoute({
  id: "remove_leave_day",
  method: "DELETE",
  path: "/timeoff/leave/{id}",
  scope: "write",
  capability: "timeoff",
  summary: "Removes one row of leave. Answers what «Undo» sends back.",
  actions: [],
  params: byDay,
  response: undoAnswer,
  errors: TIMEOFF_ERRORS,
  example: {
    params: { id: DAY_ID },
    response: { undo: UNDO_EXAMPLE, days: 0, removed: 1, pending: 0 },
  },
});

export const removeLeaveOnDate = defineRoute({
  id: "remove_leave_on_date",
  method: "DELETE",
  path: "/timeoff/days/{date}",
  scope: "write",
  capability: "timeoff",
  summary: "Removes all the leave of one date. Answers what «Undo» sends back.",
  actions: [],
  params: byDate,
  response: undoAnswer,
  errors: TIMEOFF_ERRORS,
  example: {
    params: { date: "2026-08-10" },
    response: { undo: UNDO_EXAMPLE, days: 0, removed: 1, pending: 0 },
  },
});

export const removeLeaveRange = defineRoute({
  id: "remove_leave_range",
  method: "DELETE",
  path: "/timeoff/leave",
  scope: "write",
  capability: "timeoff",
  summary: "Removes all the leave between two dates, ends included. Answers what «Undo» sends back.",
  actions: [],
  query: z.object({ from: civilDate(), to: civilDate() }),
  response: undoAnswer,
  errors: TIMEOFF_ERRORS,
  example: {
    query: { from: "2026-08-10", to: "2026-08-14" },
    response: { undo: UNDO_EXAMPLE, days: 1, removed: 1, pending: 0 },
  },
});

export const undoLeave = defineRoute({
  id: "undo_leave",
  method: "POST",
  path: "/timeoff/leave/undo",
  scope: "write",
  capability: "timeoff",
  summary: "Puts the touched days back as they were before a write, in one transaction.",
  actions: [],
  body: leaveUndo,
  response: null,
  status: 204,
  errors: TIMEOFF_ERRORS,
  example: { body: UNDO_EXAMPLE },
});
