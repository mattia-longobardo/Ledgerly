// When a connection syncs, as the wire carries it (docs/scheduler.md): the limits and the shape a
// client checks a schedule against before it asks the server. The next times and the problems of a
// schedule are the server's (`POST /connections/{id}/schedule/preview`): a client computes nothing.
// One source: the domain imports these limits and derives its schema from `syncRuleSchema`, adding
// the order of the lists and the check of a cron's values (`@ledgerly/domain/platform/integrations`).
import { z } from "zod";

/** The shortest gap between two passes of one connection, over all its rules together. */
export const MIN_SYNC_GAP_MINUTES = 15;
/** The longest interval a rule may repeat at: a rule restarts every day at its `from`. */
const MAX_INTERVAL_MINUTES = 24 * 60;
export const MAX_RULES = 8;
/** One rule's times: as many as the gap allows in a day. */
export const MAX_TIMES = (24 * 60) / MIN_SYNC_GAP_MINUTES;
/**
 * The most automatic passes in one day of a bank's connection: PSD2 lets a bank refuse more than
 * four readings a day without the person present (decision of 26/11/2026). A client disables what
 * goes over it; the server refuses it as `tooMany`.
 */
export const MAX_BANK_SYNCS_PER_DAY = 4;
/** In `monthDays`, the last day of the month. */
export const LAST_DAY = -1;
/** How many coming passes the preview answers. */
export const SCHEDULE_PREVIEW_COUNT = 5;

export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const days = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("every") }),
  z.object({ kind: z.literal("weekdays"), weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7) }),
  z.object({
    kind: z.literal("monthDays"),
    monthDays: z
      .array(
        z
          .number()
          .int()
          .refine((day) => day === LAST_DAY || (day >= 1 && day <= 31)),
      )
      .min(1)
      .max(32),
  }),
]);

/** One rule of a schedule as the wire carries it. */
export const syncRuleSchema = z.union([
  z
    .object({
      kind: z.literal("interval"),
      everyMinutes: z.number().int().min(MIN_SYNC_GAP_MINUTES).max(MAX_INTERVAL_MINUTES),
      from: timeOfDay,
      until: timeOfDay,
      days,
    })
    .refine((rule) => rule.until >= rule.from, { path: ["until"] }),
  z.object({ kind: z.literal("times"), times: z.array(timeOfDay).min(1).max(MAX_TIMES), days }),
  /** Five fields; whether they name real minutes and days is the server's answer (`invalidRule`). */
  z.object({
    kind: z.literal("cron"),
    expression: z
      .string()
      .trim()
      .max(120)
      .refine((value) => value.split(/\s+/).length === 5),
  }),
]);

/** A schedule a client may send: the shape and the limits. `rules: []` is «only by hand». */
export const syncScheduleSchema = z.object({ rules: z.array(syncRuleSchema).max(MAX_RULES) });
