// The ranges of the period controls live in `packages/format` (decision of 19/11/2026), which the domain and
// `packages/ui` share: this entry keeps the domain's path for the files that import it.
export {
  type DateRange,
  daysInRange,
  isWholeMonths,
  periodEnd,
  periodMonths,
  presetRange,
  RANGE_PRESETS,
  type RangePreset,
  shiftRange,
} from "@ledgerly/format/ranges";
