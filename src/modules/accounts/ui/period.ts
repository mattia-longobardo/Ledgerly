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
} from "@/modules/transactions/ui/filters";
import { type CivilDate, isCivilDate, type MonthKey, monthKey, monthsBetween } from "@/platform/dates";
import type { Params } from "@/ui/url";

/** The window these screens open on: the one Expenses opens on. */
export const DEFAULT_PERIOD_PRESET: RangePreset = "thisMonth";

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

/** The last day of the range that has happened: the range's end, or today if it is later. */
export function periodEnd(range: DateRange, today: CivilDate): CivilDate {
  return range.to < today ? range.to : today;
}

/**
 * The month ends a month-grain chart of the range draws, up to today's month: how many, and the
 * last. A range entirely in the future still draws its first month, never an empty chart.
 */
export function periodMonths(range: DateRange, today: CivilDate): { months: number; through: MonthKey } {
  const first = monthKey(range.from);
  const last = monthKey(periodEnd(range, today));
  const through = last < first ? first : last;
  return { months: monthsBetween(first, through).length, through };
}
