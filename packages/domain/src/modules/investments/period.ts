// src/modules/investments/period.ts — the period of the section in the address (docs/design/
// investments-ux.md §1.2, §2, U2): the old chart parameters sent to the new ones, a period written
// back as parameters and the years the stepper walks; the intervals of the chart (§2.2) are the shared
// ones. Pure: no database, no clock. Reading the address is `periodOf` in `pnl.ts`, which U1 wrote.
import { type CivilDate, isCivilDate } from "../../shared/dates";
import {
  type DateRange,
  presetRange,
  RANGE_PRESETS,
  type RangePreset,
  shiftRange,
} from "../../platform/ranges";
import { allPeriod, first, type Period, type PeriodQuery, type Query, yearQuery } from "../../shared/period";

export { barIntervals, legacyPeriodQuery, periodSpan, valueDays, yearQuery } from "../../shared/period";
export type { BarGrain, Interval } from "../../shared/period";
export type { Query } from "../../shared/period";

/**
 * The presets of Funds and Investments: the four of Expenses, and "All" — the whole history, which
 * a P&L needs and a month of spending does not.
 */
export const SECTION_PRESETS = [...RANGE_PRESETS, "all"] as const;
type SectionPreset = (typeof SECTION_PRESETS)[number];

/** These sections open on the year running: a fund has too few values for a month to say much. */
const DEFAULT_SECTION_PRESET: SectionPreset = "ytd";

interface SectionPeriod {
  /** `null` when the address carries an explicit `from`/`to`, which wins over the presets. */
  preset: SectionPreset | null;
  /** How many periods back the stepper moved. Always 0 under "All". */
  offset: number;
  /** The days the control shows; `null` under "All", which has no window to step. */
  range: DateRange | null;
  /** The period as it stands, for every link that keeps it. */
  params: PeriodQuery;
  /** The same without the stepper's offset: what the stepper's own links start from. */
  stepperParams: PeriodQuery;
  /** What the engines measure: a calendar year when the range is one, else its days up to today. */
  period: Period;
}

/** A whole calendar year, or the year running up to a day not before today. */
function yearOfRange(range: DateRange, todayOn: CivilDate): number | null {
  const year = range.from.slice(0, 4);
  if (range.from !== `${year}-01-01` || range.to.slice(0, 4) !== year) return null;
  const whole = range.to === `${year}-12-31`;
  const running = year === todayOn.slice(0, 4) && range.to >= todayOn;
  return whole || running ? Number(year) : null;
}

/**
 * The period of Funds and Investments, read from the address the way Expenses, Overview and Accounts
 * read theirs: a preset (`preset`), or the days the picker wrote (`from`/`to`), moved back by `off`
 * periods of its own length. A window that starts after today falls back to the default.
 */
export function sectionPeriod(query: Query, todayOn: CivilDate): SectionPeriod {
  const text = (name: string) => first(query[name])?.trim() ?? "";
  const from = text("from");
  const to = text("to");
  const custom = isCivilDate(from) && isCivilDate(to) && from <= to && from <= todayOn;
  const wanted = text("preset");
  const preset = custom ? null : (SECTION_PRESETS.find((key) => key === wanted) ?? DEFAULT_SECTION_PRESET);
  const stepperParams: PeriodQuery = {
    preset: preset === null || preset === DEFAULT_SECTION_PRESET ? undefined : preset,
    from: custom ? from : undefined,
    to: custom ? to : undefined,
  };
  if (preset === "all") {
    return {
      preset,
      offset: 0,
      range: null,
      params: stepperParams,
      stepperParams,
      period: { kind: "all", year: null, ...allPeriod(todayOn) },
    };
  }
  const offset = Math.max(0, Math.trunc(Number(text("off"))) || 0);
  const base = custom
    ? { from: from as CivilDate, to: to as CivilDate }
    : presetRange(preset as RangePreset, todayOn);
  // "Year to date" steps by calendar year: the one before it is the whole year before, which is the
  // P&L a person asks for, and not a window of as many months as this year has had so far.
  const back = Number(todayOn.slice(0, 4)) - offset;
  const range =
    preset === "ytd" && offset > 0
      ? { from: `${back}-01-01`, to: `${back}-12-31` }
      : shiftRange(base, -offset);
  const year = yearOfRange(range, todayOn);
  const end = range.to < todayOn ? range.to : todayOn;
  return {
    preset,
    offset,
    range,
    params: { ...stepperParams, off: offset > 0 ? String(offset) : undefined },
    stepperParams,
    period:
      year === null
        ? { kind: "custom", year: null, from: range.from, to: end }
        : { kind: "year", year, from: range.from, to: end },
  };
}

/** A period as the parameters that ask for it; the year running is the default and needs none. */
export function periodQuery(period: Period, todayOn: CivilDate): PeriodQuery {
  if (period.kind === "all") return { preset: "all" };
  if (period.kind === "custom") return { from: period.from!, to: period.to };
  return yearQuery(period.year!, todayOn);
}

/** The years the stepper walks (§2.1): from the first with data to the one running. */
export function yearsOf(firstOn: CivilDate | null, todayOn: CivilDate): { first: number; last: number } {
  const last = Number(todayOn.slice(0, 4));
  const firstYear = firstOn === null ? last : Number(firstOn.slice(0, 4));
  return { first: Math.min(firstYear, last), last };
}
