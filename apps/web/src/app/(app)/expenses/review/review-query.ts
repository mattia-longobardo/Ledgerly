// The address of «To review», read the way its server page read it: the period (a preset, «All» by
// default, or the days another page asked for, moved back by `off`), the accounts chosen and the
// guided review. Pure: "today" is passed in, and an unreadable value falls back to the default.
import { type CivilDate, isCivilDate } from "@ledgerly/format/dates";
import { type DateRange, presetRange, RANGE_PRESETS, shiftRange } from "@ledgerly/format/ranges";
import type { Params } from "@ledgerly/ui/url";

/** The four windows of Expenses, and "All" — the default: the page empties a queue, it reads no month. */
export const REVIEW_PRESETS = [...RANGE_PRESETS, "all"] as const;
type Preset = (typeof REVIEW_PRESETS)[number];

type Raw = Record<string, string | string[] | undefined>;

// The shape of an id: a hand-written `acc` must not make the read refuse the whole page.
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() ?? "";

export interface ReviewQuery {
  /** `null` when the address carries its own days, which win over a preset. */
  preset: Preset | null;
  offset: number;
  /** `null` for «All»: there is no window to move. */
  window: DateRange | null;
  /** The days the address carries, when they win. */
  custom: DateRange | null;
  /** The accounts the address names; the screen keeps only those that take an automatic category. */
  accounts: string[];
  guided: boolean;
  bank: string;
  /** The step the address asks for; the screen decides which one it shows. */
  step: string;
}

export function parseReviewQuery(raw: Raw, today: CivilDate): ReviewQuery {
  // The days another page asked for (a month of Budgets, the range of Expenses) win over a preset.
  const from = one(raw.from);
  const to = one(raw.to);
  const custom = isCivilDate(from) && isCivilDate(to) && from <= to ? { from, to } : null;
  const preset = custom ? null : (REVIEW_PRESETS.find((key) => key === one(raw.preset)) ?? "all");
  // The stepper moves a window back by periods of its own length; "All" has no window to move.
  const offset = preset === "all" ? 0 : Math.max(0, Math.trunc(Number(one(raw.off))) || 0);
  const window =
    preset === "all" ? null : shiftRange(custom ?? presetRange(preset ?? "thisMonth", today), -offset);
  return {
    preset,
    offset,
    window,
    custom,
    accounts: one(raw.acc)
      .split(",")
      .filter((id) => UUID_SHAPE.test(id)),
    guided: one(raw.guide) === "1",
    bank: one(raw.bank).slice(0, 60),
    step: one(raw.step),
  };
}

/** The address of the page as it stands, with the accounts that were kept, for every link of it. */
export function reviewParams(query: ReviewQuery, selected: readonly string[]): Params {
  return {
    preset: query.preset === "all" || query.preset === null ? undefined : query.preset,
    from: query.custom?.from,
    to: query.custom?.to,
    off: query.offset > 0 ? String(query.offset) : undefined,
    acc: selected.length > 0 ? selected.join(",") : undefined,
    guide: query.guided ? "1" : undefined,
    bank: query.guided && query.bank !== "" ? query.bank : undefined,
  };
}

export type ReviewStep = "groups" | "categories" | "done";

/**
 * The step of the guided review the page shows, `null` outside it: the groups for a person with no
 * category, "done" when asked for or when nothing is left and no pass runs, else the categories.
 */
export function reviewStep(
  query: ReviewQuery,
  { hasCategories, count, preparing }: { hasCategories: boolean; count: number; preparing: boolean },
): ReviewStep | null {
  if (!query.guided) return null;
  if (query.step === "done") return "done";
  if (!hasCategories && query.step !== "categories") return "groups";
  return count === 0 && !preparing ? "done" : "categories";
}
