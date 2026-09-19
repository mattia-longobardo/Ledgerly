import type { useTranslations } from "next-intl";
import type { CivilDate } from "@/platform/dates";
import {
  formatAmountInput,
  formatDate,
  formatMoney,
  type NumberFormat,
  type UiLocale,
} from "@/platform/format";
import type { SubscriptionRow } from "../queries";
import { type Suggestion, toleranceParts } from "../rules";
import type { SubscriptionDraft } from "./subscription-dialog";
import type { SubscriptionView } from "./subscriptions-table";
import type { SuggestionView } from "./suggestions-dialog";

type T = ReturnType<typeof useTranslations<"subscriptions">>;

interface Format {
  numberFormat: NumberFormat;
  locale: UiLocale;
}

/** A stored fraction as the percentage a person types: "0.05" is "5,00" in Italian. */
export function toleranceInput(fraction: string, numberFormat: NumberFormat): string {
  return formatAmountInput(toleranceParts(fraction) / 100n, numberFormat);
}

function draftOf(row: SubscriptionRow, t: T, format: Format): SubscriptionDraft & { id: string } {
  const { subscription } = row;
  return {
    id: subscription.id,
    state: subscription.state,
    name: subscription.name,
    categoryId: subscription.categoryId,
    paymentAccountId: subscription.paymentAccountId,
    priceInput: formatAmountInput(subscription.priceCents, format.numberFormat),
    cycle: subscription.cycle,
    nextChargeOn: subscription.nextChargeOn,
    payeeMatch: subscription.payeeMatch ?? "",
    toleranceInput: toleranceInput(subscription.tolerance, format.numberFormat),
    utility: subscription.utility,
    lastMatch: row.lastMatch
      ? t("form.lastMatch", {
          date: formatDate(row.lastMatch.on, "long", format.locale),
          amount: formatMoney(row.lastMatch.cents, format.numberFormat),
        })
      : null,
  };
}

/** The text behind the "Paid this period" pill (design tooltips). */
function statusOf(
  row: SubscriptionRow,
  t: T,
  format: Format,
): Pick<SubscriptionView, "status" | "statusDetail"> {
  const money = (cents: bigint | null) => formatMoney(cents, format.numberFormat);
  const date = (on: CivilDate) => formatDate(on, "long", format.locale);
  const account = row.accountName ?? t("anyAccount");
  const match = row.subscription.payeeMatch;
  if (match === null) return { status: "unchecked", statusDetail: t("statusDetail.unchecked") };
  const current = row.current;
  if (current === null) {
    return { status: "not_due", statusDetail: t("statusDetail.not_due", { date: date(row.nextChargeOn) }) };
  }
  switch (current.state) {
    case "paid":
      return {
        status: "paid",
        statusDetail: t("statusDetail.paid", {
          match,
          account,
          date: date(row.lastMatch?.on ?? current.dueOn),
        }),
      };
    case "amount_differs":
      return {
        status: "amount_differs",
        statusDetail: t("statusDetail.amount_differs", {
          actual: money(current.actualCents),
          expected: money(current.expectedCents),
          date: date(row.lastMatch?.on ?? current.dueOn),
        }),
      };
    case "due":
      return { status: "due", statusDetail: t("statusDetail.due", { date: date(current.dueOn) }) };
    case "not_found":
      return {
        status: "not_found",
        statusDetail: t("statusDetail.not_found", {
          match,
          period: formatDate(current.dueOn, "monthYear", format.locale),
        }),
      };
  }
}

export function presentRow(row: SubscriptionRow, t: T, format: Format): SubscriptionView {
  const money = (cents: bigint) => formatMoney(cents, format.numberFormat);
  return {
    draft: draftOf(row, t, format),
    name: row.subscription.name,
    categoryName: row.categoryName,
    utility: row.subscription.utility,
    price: money(row.subscription.priceCents),
    priceCents: row.subscription.priceCents,
    cycle: row.subscription.cycle,
    accountName: row.accountName ?? t("anyAccount"),
    monthly: money(row.monthlyCents),
    monthlyCents: row.monthlyCents,
    yearly: money(row.yearlyCents),
    yearlyCents: row.yearlyCents,
    ...statusOf(row, t, format),
  };
}

export function presentSuggestion(
  suggestion: Suggestion,
  t: T,
  format: Format,
  defaultTolerance: string,
): SuggestionView {
  return {
    key: suggestion.payeeKey,
    name: suggestion.name,
    detail: t("suggestions.detail", {
      price: formatMoney(suggestion.priceCents, format.numberFormat),
      cycle: t(`cycles.${suggestion.cycle}`),
      date: formatDate(suggestion.nextChargeOn, "long", format.locale),
      count: suggestion.occurrences,
    }),
    draft: {
      id: null,
      state: "active",
      name: suggestion.name,
      categoryId: suggestion.categoryId,
      paymentAccountId: suggestion.accountId,
      priceInput: formatAmountInput(suggestion.priceCents, format.numberFormat),
      cycle: suggestion.cycle,
      nextChargeOn: suggestion.nextChargeOn,
      payeeMatch: suggestion.name,
      toleranceInput: defaultTolerance,
      utility: 5,
      lastMatch: null,
    },
  };
}

/** An empty draft: monthly, utility 5, the default 5 % tolerance, the first charge today. */
export function newDraft(today: string, toleranceInput: string): SubscriptionDraft {
  return {
    id: null,
    state: "active",
    name: "",
    categoryId: null,
    paymentAccountId: null,
    priceInput: "",
    cycle: "monthly",
    nextChargeOn: today,
    payeeMatch: "",
    toleranceInput,
    utility: 5,
    lastMatch: null,
  };
}
