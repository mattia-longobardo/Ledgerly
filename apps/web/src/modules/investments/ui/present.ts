// How the screens of Investments write the figures of `/api/v1` (rewrite plan R3): an amount of the
// wire in the person's format, a ratio as a percentage. Formatting only: every figure is the server's.
import { parseCents } from "@ledgerly/format/cents";
import { civilDateIn, clock } from "@ledgerly/format/dates";
import { formatInstant, formatMoney, formatPercent } from "@ledgerly/format/format";
import { PALETTE } from "@ledgerly/design-tokens";
import type { Say } from "@/platform/say";

/** An amount of the wire as cents; null stays null. */
export const centsOf = (amount: string | null | undefined): bigint | null =>
  amount === null || amount === undefined ? null : parseCents(amount);

export type Money = (
  amount: string | null | undefined,
  options?: { signed?: boolean; currency?: string },
) => string;
export type Percent = (ratio: number | null | undefined, signed?: boolean) => string;

/** Amounts in the person's format, in `currency` unless an amount names its own. */
export function moneyIn(say: Say, currency: string): Money {
  return (amount, options = {}) =>
    formatMoney(centsOf(amount), say.format, {
      currency: options.currency ?? currency,
      signed: options.signed ?? false,
    });
}

/** Ratios as percentages, signed unless said otherwise. */
export function percentIn(say: Say): Percent {
  return (ratio, signed = true) => formatPercent(ratio ?? null, say.format, { signed });
}

/** An instant in words (§3.2): «today 07:30», or «27 Oct 2026, 22:30». */
export function instantText(iso: string, say: Say, todayWords: (time: string) => string): string {
  const instant = new Date(iso);
  return civilDateIn(instant, say.timeZone) === say.todayOn
    ? todayWords(clock(instant, say.timeZone))
    : formatInstant(instant, say);
}

/** A service's colour: its account's own, or the palette's at its place (the same as Accounts). */
export const colorOf = (service: { color: string | null; colorIndex: number }) =>
  service.color ?? PALETTE[service.colorIndex % PALETTE.length];
