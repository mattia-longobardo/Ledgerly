// Time off · the types of leave, the allowances by type, the working week and the days off of the
// year (rewrite plan R5g, E6): what a person states once and every figure of a year reads.
import { z } from "zod";
import { defineRoute } from "../route";
import { id } from "../primitives";
import { byYear, LEAVE_COLORS, LEAVE_UNITS, leaveType, TIMEOFF_ERRORS, typeAllowance } from "./shared";
import { TIMEOFF_YEAR_EXAMPLE, TYPE_EXAMPLE, TYPE_ID } from "./examples";

const byType = z.object({ id: id() });
const REST_DAY_ID = "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c";

const typeBody = z
  .object({
    name: z.string().trim().min(1).max(40),
    color: z.enum(LEAVE_COLORS),
    unit: z.enum(LEAVE_UNITS),
    hasAllowance: z.boolean(),
    toCalendar: z.boolean(),
  })
  .strict();
const TYPE_BODY = {
  name: TYPE_EXAMPLE.name,
  color: "primary",
  unit: "half_day",
  hasAllowance: true,
  toCalendar: true,
} as const;

export const listLeaveTypes = defineRoute({
  id: "list_leave_types",
  method: "GET",
  path: "/timeoff/types",
  scope: "read",
  capability: "timeoff",
  summary: "The person's types of leave, in their order; the country's first ones the first time.",
  actions: [],
  response: z.object({ types: z.array(leaveType) }),
  errors: [],
  example: { response: { types: TIMEOFF_YEAR_EXAMPLE.types } },
});

export const createLeaveType = defineRoute({
  id: "create_leave_type",
  method: "POST",
  path: "/timeoff/types",
  scope: "write",
  capability: "timeoff",
  summary: "Adds a type of leave at the end of the list. A name the person already uses is `conflict`.",
  actions: [],
  body: typeBody,
  response: leaveType,
  status: 201,
  errors: TIMEOFF_ERRORS,
  example: { body: TYPE_BODY, response: TYPE_EXAMPLE },
});

export const updateLeaveType = defineRoute({
  id: "update_leave_type",
  method: "PUT",
  path: "/timeoff/types/{id}",
  scope: "write",
  capability: "timeoff",
  summary:
    "Changes a type of leave: its name, colour, unit and whether it has an allowance or goes to the calendar.",
  actions: [],
  params: byType,
  body: typeBody,
  response: leaveType,
  errors: TIMEOFF_ERRORS,
  example: { params: { id: TYPE_ID }, body: TYPE_BODY, response: TYPE_EXAMPLE },
});

export const deleteLeaveType = defineRoute({
  id: "delete_leave_type",
  method: "DELETE",
  path: "/timeoff/types/{id}",
  scope: "write",
  capability: "timeoff",
  summary: "Removes a type nobody booked a day of; a type with days is `conflict`.",
  actions: [],
  params: byType,
  response: null,
  status: 204,
  errors: TIMEOFF_ERRORS,
  example: { params: { id: TYPE_ID } },
});

export const saveTypeAllowance = defineRoute({
  id: "save_type_allowance",
  method: "PUT",
  path: "/timeoff/types/{id}/allowances/{year}",
  scope: "write",
  capability: "timeoff",
  summary:
    "States what a year grants of a type, in days, and what the years before left over; a payslip's own " +
    "carry-over wins over the one stated here.",
  actions: [],
  params: byType.extend(byYear.shape),
  body: z
    .object({
      days: z.number().min(0).max(400).nullable(),
      carriedDays: z.number().min(-400).max(400).nullable(),
    })
    .strict(),
  response: typeAllowance,
  errors: TIMEOFF_ERRORS,
  example: {
    params: { id: TYPE_ID, year: "2026" },
    body: { days: 22, carriedDays: null },
    response: TIMEOFF_YEAR_EXAMPLE.allowances[0],
  },
});

const settings = z.object({
  yearStartMonth: z.number().int().min(1).max(12),
  workDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
});
const SETTINGS_EXAMPLE = { yearStartMonth: 1, workDays: [1, 2, 3, 4, 5] };

export const getLeaveSettings = defineRoute({
  id: "get_leave_settings",
  method: "GET",
  path: "/timeoff/settings",
  scope: "read",
  capability: "timeoff",
  summary: "The days of the week the person works and the month their leave year starts in.",
  actions: [],
  response: settings,
  errors: [],
  example: { response: SETTINGS_EXAMPLE },
});

export const saveLeaveSettings = defineRoute({
  id: "save_leave_settings",
  method: "PUT",
  path: "/timeoff/settings",
  scope: "write",
  capability: "timeoff",
  summary: "States the working week (0 Sunday … 6 Saturday) and the first month of the leave year.",
  actions: [],
  body: settings.strict(),
  response: settings,
  errors: ["invalid"],
  example: { body: SETTINGS_EXAMPLE, response: SETTINGS_EXAMPLE },
});

const restDay = z.object({ id: id(), month: z.number().int(), day: z.number().int(), name: z.string() });
const REST_DAY_EXAMPLE = { id: REST_DAY_ID, month: 12, day: 7, name: "Sant'Ambrogio" };

export const listRestDays = defineRoute({
  id: "list_rest_days",
  method: "GET",
  path: "/timeoff/rest-days",
  scope: "read",
  capability: "timeoff",
  summary: "The days of the year the person does not work, every year (the patron saint), by date.",
  actions: [],
  response: z.object({ days: z.array(restDay) }),
  errors: [],
  example: { response: { days: [REST_DAY_EXAMPLE] } },
});

export const addRestDay = defineRoute({
  id: "add_rest_day",
  method: "POST",
  path: "/timeoff/rest-days",
  scope: "write",
  capability: "timeoff",
  summary: "Adds a day of the year the person does not work; a date already there is `conflict`.",
  actions: [],
  body: z
    .object({
      month: z.number().int().min(1).max(12),
      day: z.number().int().min(1).max(31),
      name: z.string().trim().min(1).max(60),
    })
    .strict(),
  response: restDay,
  status: 201,
  errors: TIMEOFF_ERRORS,
  example: { body: { month: 12, day: 7, name: "Sant'Ambrogio" }, response: REST_DAY_EXAMPLE },
});

export const deleteRestDay = defineRoute({
  id: "delete_rest_day",
  method: "DELETE",
  path: "/timeoff/rest-days/{id}",
  scope: "write",
  capability: "timeoff",
  summary: "Removes a day off of the year.",
  actions: [],
  params: z.object({ id: id() }),
  response: null,
  status: 204,
  errors: ["not_found"],
  example: { params: { id: REST_DAY_ID } },
});
