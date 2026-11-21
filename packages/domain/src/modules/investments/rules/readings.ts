// Empty readings (R5), the months of a chart and a number typed in the person's format.
import { type CivilDate, monthKey, addMonths } from "../../../shared/dates";
import type { Cents } from "../../../shared/money";

// ——— Empty readings (R5) ————————————————————————————————————————————————————————————————————

/** Below this a vanished balance is believable without asking (R5): 50 €, in cents. */
const ZERO_THRESHOLD_CENTS = 5_000n;

/**
 * A valid, complete, empty answer (R5): it counts (`confirmed_zero`) when the reading before was
 * worth less than the threshold or a withdrawal of the last 7 days explains it; otherwise it waits
 * for the person (`pending_zero`) and the value holds.
 */
export function emptyReadingStatus(input: {
  previousCents: Cents | null;
  withdrawalWithin7Days: boolean;
  thresholdCents?: Cents;
}): "confirmed_zero" | "pending_zero" {
  const threshold = input.thresholdCents ?? ZERO_THRESHOLD_CENTS;
  if (input.previousCents === null || input.previousCents < threshold || input.withdrawalWithin7Days) {
    return "confirmed_zero";
  }
  return "pending_zero";
}

/** The months a chart covers, oldest first, ending with the month of `today`. */
export function monthsBack(today: CivilDate, count: number): string[] {
  const last = monthKey(today);
  return Array.from({ length: count }, (_, index) => addMonths(last, index - count + 1));
}

/**
 * A number typed in the person's format ("1.234,5" in it-IT) as the plain decimal `parseDecimal`
 * reads: spaces and group separators dropped, the decimal separator turned into a point.
 */
export function plainDecimal(input: string, separators: { decimal: string; group: string }): string {
  const cleaned = input.replace(/[\s  ]/g, "").replace(/−/g, "-");
  if (cleaned === "") throw new RangeError("Empty number");
  return cleaned.split(separators.group).join("").replace(separators.decimal, ".");
}
