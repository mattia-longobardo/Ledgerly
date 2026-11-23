/**
 * The calls of contract 2 for an external calendar of days off (rewrite plan R5c): the person's
 * leave as another planner keeps it. A plugin answers them when its manifest declares
 * `leaveCalendar`; it writes only with `provider.write` as well.
 *
 * The rule of the split: the plugin speaks to the calendar and gives its days in the words of this
 * file — one day, half or whole, of a kind the calendar names. How the calendar is written (a
 * toggle, a PUT, a plan of steps) stays in the plugin. The core decides which days the calendar
 * should hold, what is still owed and what was refused; it keeps the locks and the runs. The plugin
 * keeps nothing between two calls.
 */
import { z } from "zod";

export const CALENDAR_PATHS = {
  read: "/leave/read",
  write: "/leave/write",
  figures: "/leave/figures",
} as const;

const year = z.number().int().min(1990).max(2200);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** The person's own credentials, as the core sealed them: a flat bag of strings. */
const credentials = z.record(z.string().min(1).max(40), z.string().min(1).max(8192));
/** Half a day or a whole one: the only two sizes a day off comes in. */
const fraction = z.union([z.literal(0.5), z.literal(1)]);
/** The calendar's own word for the kind of a day: an open vocabulary, which the core maps. */
const kind = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
/** A year has at most 366 days; a little room for a calendar that answers over its own leave year. */
const MAX_DAYS = 400;

const leaveDay = z.object({ day, fraction, kind: kind.nullable() });
export type LeaveDay = z.infer<typeof leaveDay>;

/* read: the days of one year, only the person's own and only that year's */

export const leaveReadRequestSchema = z.object({ credentials, year });
export const leaveReadResponseSchema = z.object({ days: z.array(leaveDay).max(MAX_DAYS) });

/* write: what the calendar should hold, and the days to take away */

export const leaveWriteRequestSchema = z.object({
  credentials,
  year,
  /** Every day the core wants held, settled or not: one already held as asked is left alone. */
  desired: z.array(z.object({ day, fraction, kind })).max(MAX_DAYS),
  /** Days to take away. Never inferred from `desired`: a day not named is left as it is. */
  remove: z.array(day).max(MAX_DAYS),
});

/**
 * What became of one day of the request. `unchanged`: already as asked, or already absent — nothing
 * was sent. `refused`: the calendar said no and nothing landed (`not_bookable`: it does not take that
 * day, a weekend say; `permission`: the credentials may read and not write). `failed`: the outcome is
 * not known (`changed`: the calendar did something else than planned, the day moved meanwhile;
 * `unknown`: no answer) — the core reads again before deciding anything.
 */
const outcome = z.discriminatedUnion("state", [
  z.object({ day, state: z.literal("done"), reason: z.null() }),
  z.object({ day, state: z.literal("unchanged"), reason: z.null() }),
  z.object({ day, state: z.literal("refused"), reason: z.enum(["not_bookable", "permission"]) }),
  z.object({ day, state: z.literal("failed"), reason: z.enum(["changed", "unknown"]) }),
]);
export type LeaveOutcome = z.infer<typeof outcome>;

export const leaveWriteResponseSchema = z.object({
  outcomes: z.array(outcome).max(MAX_DAYS * 2),
  /** The year as the calendar holds it after the writes: what the core settles from. */
  days: z.array(leaveDay).max(MAX_DAYS),
});
export type LeaveWriteResponse = z.infer<typeof leaveWriteResponseSchema>;

/* figures: the calendar's own count of a year, shown beside the core's and never its own */

export const leaveFiguresRequestSchema = z.object({ credentials, year });
export const leaveFiguresResponseSchema = z.object({
  /** `null`: the calendar has no figures for that year. */
  figures: z
    .object({
      used: z.number().finite(),
      remaining: z.number().finite(),
      totalAvailable: z.number().finite(),
    })
    .nullable(),
});
export type LeaveFigures = NonNullable<z.infer<typeof leaveFiguresResponseSchema>["figures"]>;
