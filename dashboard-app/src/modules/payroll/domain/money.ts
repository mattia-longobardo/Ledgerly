const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Exact addition of two two-decimal money strings, via `BigInt` cents — the
 * same fixed-point discipline `interests/domain/accrual.ts` uses, and the
 * reason `Number()` never appears anywhere near a payroll figure.
 *
 * `null` means "the payslip did not carry this half", which is not the same as
 * zero: two absent halves produce `null`, so the fund bridge writes nothing
 * rather than a `0.00` deposit and an Earnings bucket reports "—" rather than a
 * figure nobody stated.
 *
 * It lives in `domain/` because both the earnings summary and the fund bridge
 * need it, and a shared helper reached through `infrastructure/` would invert
 * the module's own layering.
 */
export function addMoney(a: string | null, b: string | null): string | null {
  if (a === null && b === null) return null;
  const cents = (v: string | null): bigint => {
    if (v === null) return 0n;
    const m = DECIMAL_RE.exec(v.trim());
    if (!m) throw new Error(`not a decimal: ${v}`);
    const [, sign, intPart, fracPart = ""] = m;
    const frac = (fracPart + "00").slice(0, 2);
    return BigInt(`${sign}${intPart}${frac}`);
  };
  const total = cents(a) + cents(b);
  const negative = total < 0n;
  const abs = (negative ? -total : total).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}
