// How the domain writes numbers and dates live in `packages/format` (decision of 19/11/2026), which the domain and `packages/ui`
// share: this entry keeps the domain's path for the files that import it.
export {
  formatAmountInput,
  formatDate,
  formatDecimalText,
  formatMoney,
  formatPercent,
  formatWholePercent,
  intlLocale,
  monthName,
  NULL_DISPLAY,
  type NumberFormat,
  numberSeparators,
  numberStyle,
  type NumberStyle,
  parseAmount,
  type UiLocale,
} from "@ledgerly/format/format";
