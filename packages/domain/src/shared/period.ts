// The period in an address (docs/design/investments-ux.md §1.2): the parameters a link carries, a
// year as those parameters, the old parameters sent to the new ones, and the days a period really
// spans. Pure and shared: Funds and Investments read their address the same way (audit FND-7).
import { addMonths, type CivilDate, isCivilDate, lastDayOfMonth, monthKey } from "./dates";

export type Query = Record<string, string | string[] | undefined>;

/** The parameters of the period (§1.2): what a link carries from one page or tab to the next. */
export type PeriodQuery = { preset?: string; from?: string; to?: string; off?: string };

/** A calendar year as the parameters that ask for it; the year running is the default and needs none. */
export function yearQuery(year: number, todayOn: CivilDate): PeriodQuery {
  const back = Number(todayOn.slice(0, 4)) - year;
  return back > 0 ? { off: String(back) } : {};
}

/** The first value of a parameter given once or many times. */
export const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const MONTH = /^\d{4}-\d{2}$/;

/**
 * The address of the charts before U2 (`range=3m|1y|all`, `from`/`to` by month, `grain`) sent to
 * the nearest new one (§1.2), so a saved link still opens: `1y` → the year running, `all` → `all`,
 * `3m` → the three months to today by day, months → their first and last day. `grain` goes, the
 * granularity is automatic (§2.2). Every other parameter stays. `null` when nothing is old.
 */
export function legacyPeriodQuery(query: Query, todayOn: CivilDate): Record<string, string> | null {
  const range = first(query.range);
  const grain = first(query.grain);
  const from = first(query.from);
  const to = first(query.to);
  const months = from !== undefined && to !== undefined && MONTH.test(from) && MONTH.test(to);
  const period = first(query.period);
  if (range === undefined && grain === undefined && !months && period === undefined) return null;

  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(query)) {
    const one = first(value);
    if (one === undefined || ["range", "grain", "from", "to", "period"].includes(name)) continue;
    kept[name] = one;
  }
  if (months) {
    const [start, end] = from! <= to! ? [from!, to!] : [to!, from!];
    return { ...kept, from: `${start}-01`, to: lastDayOfMonth(`${end}-01`) };
  }
  // A day range the picker wrote stays: only `range` or `grain` came along with it.
  if (from !== undefined && to !== undefined && isCivilDate(from) && isCivilDate(to)) {
    return { ...kept, from, to };
  }
  if (range === "all") return { ...kept, preset: "all" };
  if (range === "3m") return { ...kept, from: addMonths(monthKey(todayOn), -2), to: todayOn };
  // The period before the presets: `period=all`, or a year.
  if (period === "all") return { ...kept, preset: "all" };
  if (period !== undefined && /^\d{4}$/.test(period)) {
    const year = Number(period);
    if (year >= 1970) return { ...kept, ...yearQuery(year, todayOn) };
  }
  return kept;
}

/**
 * The days the period really spans: "All" starts on the first day with data (today when there is
 * none), a year never before it either, so the chart does not draw an empty stretch.
 */
export function periodSpan(
  period: { kind: string; from: CivilDate | null; to: CivilDate },
  firstOn: CivilDate | null,
): { from: CivilDate; to: CivilDate } {
  const start = period.from ?? firstOn ?? period.to;
  const from = period.kind === "custom" || firstOn === null || start >= firstOn ? start : firstOn;
  return { from: from > period.to ? period.to : from, to: period.to };
}
