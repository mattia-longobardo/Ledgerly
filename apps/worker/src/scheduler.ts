/**
 * The worker's clock (rewrite plan R1): which tiers start at a minute, read on the wall clock of the
 * schedule's zone. The same rule as cron: a field left out is every value.
 */

type At = { minute?: number; hour?: number; dayOfMonth?: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClock(instant: Date, timeZone: string): { minute: number; hour: number; dayOfMonth: number } {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    });
    formatters.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(instant).map((part) => [part.type, part.value]));
  return { minute: Number(parts.minute), hour: Number(parts.hour), dayOfMonth: Number(parts.day) };
}

/** The tiers whose time is the minute of `instant`, in the order of `tiers`. */
export function dueTiers<T extends string>(
  instant: Date,
  tiers: readonly T[],
  schedule: Readonly<Record<T, At>>,
  timeZone: string,
): T[] {
  const now = wallClock(instant, timeZone);
  const fields = ["minute", "hour", "dayOfMonth"] as const;
  return tiers.filter((tier) =>
    fields.every((field) => schedule[tier][field] === undefined || schedule[tier][field] === now[field]),
  );
}

/** The start of the minute `instant` is in. */
export function minuteOf(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / 60_000) * 60_000);
}
