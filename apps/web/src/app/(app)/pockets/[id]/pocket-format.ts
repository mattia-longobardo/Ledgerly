// The two formatters every block of a pocket's page shares: an amount of the wire, a date.
import { parseCents } from "@ledgerly/format/cents";
import { formatDate, formatMoney } from "@ledgerly/format/format";
import type { DialogContext } from "@/modules/pockets/client";

export interface PocketFormat {
  /** An amount of the wire; null is the empty mark. `spent` negates it: the pages show what went out. */
  money: (amount: string | null, options?: { decimals?: boolean; spent?: boolean }) => string;
  date: (day: string, style: "long" | "month" | "monthShort" | "monthYear") => string;
}

export function pocketFormat(context: DialogContext): PocketFormat {
  return {
    money: (amount, { decimals = true, spent = false } = {}) =>
      formatMoney(
        amount === null ? null : spent ? -parseCents(amount) : parseCents(amount),
        context.numberFormat,
        { decimals },
      ),
    date: (day, style) => formatDate(day, style, context.locale),
  };
}
