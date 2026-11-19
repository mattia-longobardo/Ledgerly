import { type NumberFormat, formatMoney } from "@ledgerly/domain/platform/format";
import type { Cents } from "@ledgerly/domain/shared/money";
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
export { changeBetween, shareOf } from "@ledgerly/domain/accounts";

/**
 * An account's value in the display currency, for the line under its own (§1.8): `null` when the
 * account is already in that currency, so nothing is said twice. A missing rate is the dash.
 */
export function counterValue(
  row: { account: { currency: string }; display: { balance: Cents | null } },
  currency: string,
  format: NumberFormat,
): string | null {
  if (row.account.currency === currency) return null;
  return `≈ ${formatMoney(row.display.balance, format, { currency })}`;
}

type Since = { unit: "never" } | { unit: "minutes" | "hours" | "days"; count: number };

/** How long ago an instant was, in the coarse steps the design's "Last synced" column uses. */
export function since(instant: Date | null, now: Date): Since {
  if (instant === null) return { unit: "never" };
  const minutes = Math.max(0, Math.round((now.getTime() - instant.getTime()) / 60_000));
  if (minutes < 60) return { unit: "minutes", count: minutes };
  const hours = Math.round(minutes / 60);
  if (hours < 48) return { unit: "hours", count: hours };
  return { unit: "days", count: Math.round(hours / 24) };
}
