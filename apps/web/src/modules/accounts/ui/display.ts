import { type Cents, parseCents } from "@ledgerly/format/cents";
import { type NumberFormat, formatMoney } from "@ledgerly/format/format";
import { PALETTE } from "@ledgerly/design-tokens";

export function colorFor(account: { color: string | null }, index: number): string {
  return account.color ?? PALETTE[index % PALETTE.length];
}

/**
 * What a colour control shows, and what it means. The value is the colour the account is really
 * drawn with — `colorFor` decides it, so the form and the charts cannot disagree — and `automatic`
 * says that colour is the palette's rather than one a person chose. The two are separate on
 * purpose: an account with no colour of its own must be able to keep having none, so that reordering
 * the accounts still moves its colour; a form that only knew the value would save the derived
 * colour back as a chosen one on the first save.
 */
export function colorField(
  account: { color: string | null },
  index: number,
): { value: string; automatic: boolean } {
  return { value: colorFor(account, index), automatic: account.color === null };
}

// The change and the share are the domain's rule, the same one `/api/v1` answers.
export { changeBetween, shareOf } from "@ledgerly/domain/accounts/client";

/** An amount of `/api/v1` (a decimal, or null when unknown) as the cents the formatting reads. */
export function centsOf(amount: string | null): Cents | null {
  return amount === null ? null : parseCents(amount);
}

/**
 * An account's value in the display currency, for the line under its own (§1.8): `null` when the
 * account is already in that currency, so nothing is said twice. A missing rate is the dash.
 */
export function counterValue(
  row: { currency: string; display: { balance: Cents | null } },
  currency: string,
  format: NumberFormat,
): string | null {
  if (row.currency === currency) return null;
  return `≈ ${formatMoney(row.display.balance, format, { currency })}`;
}
