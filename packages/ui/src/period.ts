/**
 * The period of Overview, Accounts and Account detail (PERS-342), read from the address the way
 * Expenses reads its own (spec §8.4 point 2): a preset (`preset`), or the days the picker wrote
 * (`from`/`to`), moved back by `off` periods of its own length. The same four presets and the
 * same stepper as Expenses, so the four screens speak of time in one way. Pure: "today" is passed
 * in, and an unreadable value falls back to the default rather than failing the page.
 */

import {
  type DateRange,
  DAY_GRAIN_MAX_DAYS,
  daysInRange,
  presetRange,
  RANGE_PRESETS,
  type RangePreset,
  shiftRange,
} from "@ledgerly/format/ranges";
import { type CivilDate, isCivilDate } from "@ledgerly/format/dates";
import type { Params } from "./url";

// The days a period has happened through live with the ranges, which the domain shares.
export { periodEnd, periodMonths } from "@ledgerly/format/ranges";

/** The window these screens open on: the one Expenses opens on. */
const DEFAULT_PERIOD_PRESET: RangePreset = "thisMonth";

export interface PeriodQuery {
  /** `null` when the address carries an explicit `from`/`to`, which wins over the presets. */
  preset: RangePreset | null;
  /** How many periods back from the preset or the range the stepper moved. */
  offset: number;
  range: DateRange;
  /** The chart's grain: the one the address chose, or the one the range calls for (F2.5). */
  grain: "day" | "month";
  /** The period as it stands, for every link that keeps it. */
  params: Params;
  /** The same without the stepper's offset: what the stepper's own links start from. */
  stepperParams: Params;
}

type Raw = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function civilDate(value: string): CivilDate | null {
  return value !== "" && isCivilDate(value) ? value : null;
}

/**
 * The period the address asks for. `grainParam` names the chart's grain parameter: Accounts calls
 * it `chart`, because there `grain` was the table's.
 */
export function parsePeriodQuery(raw: Raw, today: CivilDate, grainParam = "grain"): PeriodQuery {
  const from = civilDate(one(raw.from));
  const to = civilDate(one(raw.to));
  const custom = from !== null && to !== null && from <= to;
  const wanted = one(raw.preset);
  const preset = custom ? null : (RANGE_PRESETS.find((key) => key === wanted) ?? DEFAULT_PERIOD_PRESET);
  const offset = Math.max(0, Math.trunc(Number(one(raw.off))) || 0);
  const base = custom ? { from, to } : presetRange(preset ?? DEFAULT_PERIOD_PRESET, today);
  const range = shiftRange(base, -offset);
  const wantedGrain = one(raw[grainParam]);
  const chosen = wantedGrain === "day" || wantedGrain === "month" ? wantedGrain : null;
  const grain = chosen ?? (daysInRange(range) <= DAY_GRAIN_MAX_DAYS ? "day" : "month");
  const stepperParams: Params = {
    preset: preset === null || preset === DEFAULT_PERIOD_PRESET ? undefined : preset,
    from: custom ? from : undefined,
    to: custom ? to : undefined,
    [grainParam]: chosen ?? undefined,
  };
  return {
    preset,
    offset,
    range,
    grain,
    params: { ...stepperParams, off: offset > 0 ? String(offset) : undefined },
    stepperParams,
  };
}

/** The year an address asks for (`?year=`): a whole year from 1990 up to `last`; anything else is `current`. */
export function parseYearQuery(
  asked: string | string[] | null | undefined,
  current: number,
  last: number,
): number {
  const year = Number(Array.isArray(asked) ? asked[0] : asked);
  return Number.isInteger(year) && year >= 1990 && year <= last ? year : current;
}

/** The presets of Funds and Investments: the four of Expenses, and "All", the whole history. */
export const SECTION_PRESETS = [...RANGE_PRESETS, "all"] as const;
type SectionPreset = (typeof SECTION_PRESETS)[number];
/** These sections open on the year running: a fund has too few values for a month to say much. */
const DEFAULT_SECTION_PRESET: SectionPreset = "ytd";

/** The period of `GET /funds` and its tabs: all, a calendar year, or custom days. */
export type SectionApiQuery =
  { period: "all" } | { period: string } | { period: "custom"; from: string; to: string };

export interface SectionQuery {
  preset: SectionPreset | null;
  offset: number;
  /** `null` under "All", which has no window to step. */
  range: DateRange | null;
  params: Params;
  stepperParams: Params;
  /** What the address asks the API for: the server measures it and answers its days. */
  api: SectionApiQuery;
}

/** A whole calendar year, or the year running up to a day not before today. */
function yearOfRange(range: DateRange, today: CivilDate): number | null {
  const year = range.from.slice(0, 4);
  if (range.from !== `${year}-01-01` || range.to.slice(0, 4) !== year) return null;
  const whole = range.to === `${year}-12-31`;
  const running = year === today.slice(0, 4) && range.to >= today;
  return whole || running ? Number(year) : null;
}

/** The address's own days, when they are real days in order that start by today. */
function pickedDays(raw: Raw, today: CivilDate): DateRange | null {
  const from = civilDate(one(raw.from));
  const to = civilDate(one(raw.to));
  return from !== null && to !== null && from <= to && from <= today ? { from, to } : null;
}

/** The window of a preset or of the picked days, moved back `offset` times; "Year to date" steps by year. */
function sectionRange(
  preset: SectionPreset | null,
  picked: DateRange | null,
  offset: number,
  today: CivilDate,
) {
  if (preset === "ytd" && offset > 0) {
    const back = Number(today.slice(0, 4)) - offset;
    return { from: `${back}-01-01`, to: `${back}-12-31` };
  }
  return shiftRange(
    picked ?? presetRange(preset === null || preset === "all" ? "ytd" : preset, today),
    -offset,
  );
}

/**
 * The period of Funds and Investments in the address, read as `sectionPeriod` of the server pages read
 * it: a preset, or the days the picker wrote, moved back by `off` periods of its own length. "Year to
 * date" steps by calendar year. What it measures is the server's: `api` only names it.
 */
export function parseSectionQuery(raw: Raw, today: CivilDate): SectionQuery {
  const picked = pickedDays(raw, today);
  const wanted = one(raw.preset);
  const preset = picked ? null : (SECTION_PRESETS.find((key) => key === wanted) ?? DEFAULT_SECTION_PRESET);
  const stepperParams: Params = {
    preset: preset === null || preset === DEFAULT_SECTION_PRESET ? undefined : preset,
    from: picked?.from,
    to: picked?.to,
  };
  if (preset === "all") {
    return { preset, offset: 0, range: null, params: stepperParams, stepperParams, api: { period: "all" } };
  }
  const offset = Math.max(0, Math.trunc(Number(one(raw.off))) || 0);
  const range = sectionRange(preset, picked, offset, today);
  const year = yearOfRange(range, today);
  return {
    preset,
    offset,
    range,
    params: { ...stepperParams, off: offset > 0 ? String(offset) : undefined },
    stepperParams,
    api: year === null ? { period: "custom", from: range.from, to: range.to } : { period: String(year) },
  };
}
