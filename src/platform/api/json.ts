import { type Cents, centsToDecimal, parseCents } from "@/platform/money";

/**
 * Money on the wire. Amounts are `bigint` cents everywhere in this codebase, and JSON's number is
 * a double: 9007199254740993 cents would come back as a different amount, silently. So every
 * amount leaves as a decimal **string** — "1234.56" — and an unknown one as `null`, which is what
 * `null` means in the database too (spec §4.3).
 */
export function money(cents: Cents | null): string | null {
  return cents === null ? null : centsToDecimal(cents);
}

/** A timestamp on the wire: ISO 8601 in UTC, or null. Civil dates stay `YYYY-MM-DD` as they are. */
export function instant(at: Date | null | undefined): string | null {
  return at ? at.toISOString() : null;
}

/**
 * The inverse of {@link money} on the way in: a decimal **string** becomes `bigint` cents, which
 * is what every service takes. A JSON number is refused rather than coerced — 0.1 + 0.2 is not the
 * amount anybody typed, and a rounding an API invented is a rounding nobody can find later.
 */
export function centsFrom(value: unknown): Cents | null {
  if (typeof value !== "string") return null;
  try {
    return parseCents(value);
  } catch {
    return null;
  }
}
