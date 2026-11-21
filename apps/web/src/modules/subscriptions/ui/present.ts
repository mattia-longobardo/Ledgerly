// What the Subscriptions page shows of one row of `GET /subscriptions` (rewrite plan R3): every figure
// is a field of the route; this file formats it, in the person's number format and language.
import type { useTranslations } from "next-intl";
import type { subscriptions } from "@ledgerly/api-contract/subscriptions";
import type { RouteOutput } from "@ledgerly/api-client";
import { parseCents } from "@ledgerly/format/cents";
import {
  formatAmountInput,
  formatDate,
  formatMoney,
  intlLocale,
  monthName,
  type NumberFormat,
  type UiLocale,
} from "@ledgerly/format/format";
import { dueMoment } from "@ledgerly/domain/subscriptions/client";
import type { SubscriptionDraft } from "./subscription-dialog";
import type { SubscriptionView } from "./subscriptions-table";
import type { SuggestionView } from "./suggestions-dialog";

type T = ReturnType<typeof useTranslations<"subscriptions">>;
type Row = RouteOutput<typeof subscriptions.listSubscriptions>["subscriptions"][number];
type Suggestion = RouteOutput<typeof subscriptions.listSubscriptionSuggestions>["suggestions"][number];

export interface Format {
  numberFormat: NumberFormat;
  locale: UiLocale;
}

/** A decimal of the wire as the person types it: "5.00" is "5,00" in Italian. */
const typed = (decimal: string, format: Format) =>
  formatAmountInput(parseCents(decimal), format.numberFormat);

/** The tolerance the dialog starts from when none is typed: the contract's 5 %. */
const defaultTolerance = (format: Format) => typed("5", format);

function draftOf(row: Row, text: T, format: Format): SubscriptionDraft & { id: string } {
  return {
    id: row.id,
    state: row.state,
    name: row.name,
    categoryId: row.categoryId,
    paymentAccountId: row.accountId,
    priceInput: typed(row.price, format),
    cycle: row.cycle,
    // The dialog edits the anchor of the calendar, the date the person entered.
    nextChargeOn: row.chargeOn,
    payeeMatch: row.payeeMatch ?? "",
    toleranceInput: typed(row.tolerance, format),
    utility: row.utility,
    lastMatch: row.lastMatch
      ? text("form.lastMatch", {
          date: formatDate(row.lastMatch.on, "long", format.locale),
          amount: formatMoney(parseCents(row.lastMatch.amount), format.numberFormat),
        })
      : null,
  };
}

/** The text behind the "Paid this period" pill (design tooltips). */
function statusOf(row: Row, text: T, format: Format): Pick<SubscriptionView, "status" | "statusDetail"> {
  const money = (amount: string | null) =>
    formatMoney(amount === null ? null : parseCents(amount), format.numberFormat);
  const date = (on: string) => formatDate(on, "long", format.locale);
  const match = row.payeeMatch;
  if (match === null) return { status: "unchecked", statusDetail: text("statusDetail.unchecked") };
  const current = row.current;
  if (current === null) {
    return {
      status: "not_due",
      statusDetail: text("statusDetail.not_due", { date: date(row.nextChargeOn) }),
    };
  }
  switch (current.state) {
    case "paid":
      return {
        status: "paid",
        statusDetail: text("statusDetail.paid", {
          match,
          account: row.account ?? text("anyAccount"),
          date: date(row.lastMatch?.on ?? current.dueOn),
        }),
      };
    case "amount_differs":
      return {
        status: "amount_differs",
        statusDetail: text("statusDetail.amount_differs", {
          actual: money(current.actual),
          expected: money(current.expected),
          date: date(row.lastMatch?.on ?? current.dueOn),
        }),
      };
    case "due":
      return { status: "due", statusDetail: text("statusDetail.due", { date: date(current.dueOn) }) };
    case "not_found":
      return {
        status: "not_found",
        statusDetail: text("statusDetail.not_found", {
          match,
          period: formatDate(current.dueOn, "monthYear", format.locale),
        }),
      };
  }
}

/**
 * When in its cycle a subscription falls due, in the unit that identifies it (owner, 2026-09-21):
 * the day for a monthly one, the quarter for a quarterly one, the month for a yearly one, the
 * weekday for a weekly one. The exact date is still there — the cell carries it as its title.
 *
 * The weekday is built from a fixed UTC Sunday plus the index, so no local `Date` is involved and
 * no civil date is parsed twice.
 */
function presentDue(row: Row, text: T, format: Format): string {
  const moment = dueMoment(row.cycle, row.nextChargeOn);
  switch (moment.kind) {
    case "day":
      return text("due.day", { day: moment.day });
    case "quarter":
      return text("due.quarter", { quarter: moment.quarter });
    case "month":
      return monthName(row.nextChargeOn, format.locale, "long");
    case "weekday":
      return new Intl.DateTimeFormat(intlLocale(format.locale), {
        weekday: "long",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(2024, 0, 7 + moment.weekday)));
  }
}

export function presentRow(row: Row, text: T, format: Format): SubscriptionView {
  const money = (amount: string) => formatMoney(parseCents(amount), format.numberFormat);
  return {
    draft: draftOf(row, text, format),
    name: row.name,
    categoryName: row.category,
    categoryColor: row.categoryColor,
    due: presentDue(row, text, format),
    dueOn: formatDate(row.nextChargeOn, "long", format.locale),
    utility: row.utility,
    price: money(row.price),
    priceCents: parseCents(row.price),
    cycle: row.cycle,
    accountName: row.account ?? text("anyAccount"),
    monthly: money(row.monthly),
    monthlyCents: parseCents(row.monthly),
    yearly: money(row.yearly),
    yearlyCents: parseCents(row.yearly),
    ...statusOf(row, text, format),
  };
}

export function presentSuggestion(suggestion: Suggestion, text: T, format: Format): SuggestionView {
  return {
    key: suggestion.key,
    name: suggestion.name,
    detail: text("suggestions.detail", {
      price: formatMoney(parseCents(suggestion.price), format.numberFormat),
      cycle: text(`cycles.${suggestion.cycle}`),
      date: formatDate(suggestion.nextChargeOn, "long", format.locale),
      count: suggestion.occurrences,
    }),
    draft: {
      id: null,
      state: "active",
      name: suggestion.name,
      categoryId: suggestion.categoryId,
      paymentAccountId: suggestion.accountId,
      priceInput: typed(suggestion.price, format),
      cycle: suggestion.cycle,
      nextChargeOn: suggestion.nextChargeOn,
      payeeMatch: suggestion.name,
      toleranceInput: defaultTolerance(format),
      utility: 5,
      lastMatch: null,
    },
  };
}

/** An empty draft: monthly, utility 5, the default 5 % tolerance, the first charge today. */
export function newDraft(today: string, format: Format): SubscriptionDraft {
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
    toleranceInput: defaultTolerance(format),
    utility: 5,
    lastMatch: null,
  };
}
