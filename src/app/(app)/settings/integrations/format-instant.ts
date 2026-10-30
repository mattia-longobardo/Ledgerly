import type { Ctx } from "@/platform/context";
import { civilDateIn } from "@/platform/dates";
import { formatDate } from "@/platform/format";

/**
 * An instant as a connection shows it: the civil day in the user's zone (spec §8.5) and the clock,
 * because an hourly sync is told apart by its time of day and `platform/format` has no date-time
 * style yet. In 24 hours, as the schedule itself is written.
 */
export function formatInstant(instant: Date, ctx: Pick<Ctx, "locale" | "timeZone">): string {
  const day = formatDate(civilDateIn(instant, ctx.timeZone), "long", ctx.locale);
  const clock = new Intl.DateTimeFormat(ctx.locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: ctx.timeZone,
  }).format(instant);
  return `${day}, ${clock}`;
}
