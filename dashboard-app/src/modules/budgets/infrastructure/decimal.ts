/**
 * Mirrors the `numeric(16, 2)` scale money columns carry in Postgres — same
 * rationale as the expenses module's `normalizeMoney`: the real repository
 * always reads back a two-decimal string, so a caller that echoed the raw
 * input verbatim would let a string-comparing check pass in one backend and
 * fail in the other. A plain regex, never `Number()`.
 *
 * Module-local: shared by `memory-repositories.ts` (to match what Postgres
 * would store) and `drizzle-scopes-usages-repository.ts` (to compare an
 * incoming `replaceScopeMatched` amount against the stored one without a
 * false "changed" from formatting alone, e.g. `"10"` vs `"10.00"`).
 */
const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

export function normalizeScale(value: string, scale: number): string {
  const m = DECIMAL_RE.exec(value.trim());
  if (!m) return value;
  const [, sign, intPart, fracPart = ""] = m;
  const frac = (fracPart + "0".repeat(scale)).slice(0, scale);
  return scale > 0 ? `${sign}${intPart}.${frac}` : `${sign}${intPart}`;
}
