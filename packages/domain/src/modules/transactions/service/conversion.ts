// modules/transactions/service/conversion.ts — the rates the rules of the giroconti read to pair an
// Investments leg with its bank movement in another currency (PERS-659).
import { convertCents, ratesOn } from "../../../platform/fx";
import { civilDateIn } from "../../../shared/dates";
import type { ConvertCents } from "../rules";

/**
 * The conversion the rules use for an Investments leg in another currency than its bank movement:
 * the rates of the rows' days, read only when there is such a leg.
 */
export async function conversionFor(
  rows: readonly { occurredAt: Date; currency: string; origin: string }[],
): Promise<ConvertCents | undefined> {
  const currencies = new Set(rows.map((row) => row.currency));
  if (currencies.size < 2 || !rows.some((row) => row.origin === "investments")) return undefined;
  // shortcut: a movement's day is its UTC day, one fixing off at most around midnight; the gap absorbs it.
  const dayOf = (instant: Date) => civilDateIn(instant, "UTC");
  const days = rows.map((row) => dayOf(row.occurredAt)).sort();
  const rates = await ratesOn(currencies, days[0]!, days[days.length - 1]!);
  return (cents, from, to, instant) => convertCents(cents, from, to, dayOf(instant), rates);
}
