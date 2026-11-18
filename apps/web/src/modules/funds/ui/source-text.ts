// The words and the checks of a contribution source, shared by the form that creates a fund, the
// source dialog and the list in Settings (release N6, screens §3.3 and §6.2). Pure: the translator
// comes from the caller, the server's `getTranslations` or the client's `useTranslations`.
import type { useTranslations } from "next-intl";
import { parseAmount } from "@ledgerly/domain/platform/format";
import { type CivilDate, isCivilDate } from "@ledgerly/domain/shared/dates";
import { formatDate, formatMoney, type NumberFormat, type UiLocale } from "@ledgerly/domain/platform/format";
import type { SourceForm } from "@ledgerly/domain/funds/client";
import {
  type DueCalendar,
  type DueEntry,
  type IntervalUnit,
  PAYROLL_COMPONENTS,
  type PayrollComponent,
} from "@ledgerly/domain/funds/client";

export type SourcesT = ReturnType<typeof useTranslations<"funds.sources">>;

/** The components already held by another fund: component → that fund's name. */
export type TakenComponents = Partial<Record<PayrollComponent, string>>;

/** "every month", "every 3 months", "every 2 weeks". */
export function frequencyText(t: SourcesT, count: number, unit: IntervalUnit): string {
  return t("debit.frequencyText", { count, unit: t(`debit.units.${unit}`, { count }) });
}

/** "My contribution, employer, TFR": the first name as it is written, the others in running text. */
function componentsText(t: SourcesT, components: readonly PayrollComponent[]): string {
  return PAYROLL_COMPONENTS.filter((component) => components.includes(component))
    .map((component, index) => {
      const name = t(`components.${component}`);
      // An acronym stays in capitals.
      return index === 0 || name === name.toUpperCase() ? name : name.charAt(0).toLowerCase() + name.slice(1);
    })
    .join(", ");
}

/** "20 Jan · 20 Apr · 20 Jul · 20 Oct". */
export function dueDatesText(dates: readonly CivilDate[], locale: UiLocale): string {
  return dates.map((date) => formatDate(date, "dayMonth", locale)).join(" · ");
}

/** Explicit due dates as day/month, in the order of their periods: "20/4 · 20/7 · 20/10 · 20/1". */
export function customDueText(entries: readonly DueEntry[]): string {
  return entries.map((entry) => `${entry.day}/${entry.month}`).join(" · ");
}

const wholeIn = (text: string, min: number, max: number): number | null => {
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value >= min && value <= max ? value : null;
};

/** The due dates the three fields of a form say; none while they are not filled in. */
export function calendarOfForm(form: SourceForm): DueCalendar {
  const day = wholeIn(form.dueDay, 1, 31);
  const offsetMonths = wholeIn(form.dueOffsetMonths, 0, 3);
  return {
    rule: form.hasDue && day !== null && offsetMonths !== null ? { day, offsetMonths } : null,
    entries: [],
  };
}

function moneyText(text: string, format: NumberFormat, currency: string): string {
  try {
    return formatMoney(parseAmount(text, format), format, { currency });
  } catch {
    return text.trim();
  }
}

/**
 * The line under a source's title. For a debit only the parts that are filled in appear; for a
 * payslip the due date follows the three fields, or the explicit dates the source still keeps.
 */
export function sourceSummary(
  t: SourcesT,
  form: SourceForm,
  options: {
    format: NumberFormat;
    locale: UiLocale;
    currency: string;
    accountName?: string | null;
    /** The explicit due dates of a source that keeps them, already as text. */
    customDue?: string | null;
  },
): string {
  if (form.kind === "manual") return t("summary.manual");
  if (form.kind === "payroll") {
    const parts = [
      t("summary.payroll", {
        components: componentsText(t, form.components),
        period: t(`period.${form.accrualPeriod}`).toLowerCase(),
      }),
    ];
    const { rule } = calendarOfForm(form);
    if (rule !== null) {
      parts.push(
        t("summary.due", {
          day: rule.day,
          offset: rule.offsetMonths,
          days: wholeIn(form.toleranceDays, 0, 120) ?? 15,
        }),
      );
    } else if (form.customDue && options.customDue) {
      parts.push(t("due.custom", { dates: options.customDue }));
    }
    return parts.join(" · ");
  }
  const count = wholeIn(form.frequencyCount, 1, 120) ?? 1;
  const day = wholeIn(form.debitDay, 1, 31);
  const first = t("summary.debitAmount", {
    amount: moneyText(form.amount, options.format, options.currency),
    frequency: frequencyText(t, count, form.frequencyUnit),
  });
  const parts = [
    day !== null && form.frequencyUnit !== "week" ? `${first}, ${t("summary.debitDay", { day })}` : first,
  ];
  if (options.accountName) parts.push(t("summary.debitAccount", { account: options.accountName }));
  if (form.payeeMatch.trim() !== "") parts.push(t("summary.debitMatch", { match: form.payeeMatch.trim() }));
  if (isCivilDate(form.validFrom)) {
    parts.push(t("summary.debitFrom", { date: formatDate(form.validFrom, "long", options.locale) }));
  }
  if (isCivilDate(form.validTo)) {
    parts.push(t("summary.debitTo", { date: formatDate(form.validTo, "long", options.locale) }));
  }
  return parts.join(" · ");
}

/** The fields of a source a message can sit under, in the order of the form. */
const SOURCE_FIELDS = [
  "components",
  "dueDay",
  "toleranceDays",
  "amount",
  "frequencyCount",
  "debitDay",
  "validTo",
  "payeeMatch",
] as const;
export type SourceField = (typeof SOURCE_FIELDS)[number];

/** A message of `funds.sources.errors`, by the field it belongs under. */
type SourceProblems = Partial<
  Record<
    SourceField,
    "component" | "dueDay" | "tolerance" | "amount" | "frequency" | "debitDay" | "dates" | "match"
  >
>;

/** What is wrong in a source's fields before it is sent: the same limits the service holds. */
export function sourceProblems(form: SourceForm, format: NumberFormat): SourceProblems {
  const problems: SourceProblems = {};
  if (form.kind === "payroll") {
    if (form.components.length === 0) problems.components = "component";
    if (form.hasDue && wholeIn(form.dueDay, 1, 31) === null) problems.dueDay = "dueDay";
    if (form.hasDue && form.toleranceDays.trim() !== "" && wholeIn(form.toleranceDays, 0, 120) === null) {
      problems.toleranceDays = "tolerance";
    }
  }
  if (form.kind === "bank_debit") {
    try {
      if (parseAmount(form.amount, format) <= 0n) problems.amount = "amount";
    } catch {
      problems.amount = "amount";
    }
    if (wholeIn(form.frequencyCount, 1, 120) === null) problems.frequencyCount = "frequency";
    if (
      form.frequencyUnit !== "week" &&
      form.debitDay.trim() !== "" &&
      wholeIn(form.debitDay, 1, 31) === null
    ) {
      problems.debitDay = "debitDay";
    }
    if (form.validFrom !== "" && form.validTo !== "" && form.validTo < form.validFrom)
      problems.validTo = "dates";
    if (form.payeeMatch.trim() === "") problems.payeeMatch = "match";
  }
  return problems;
}

/** The first field of a source with a message, to give it the focus. */
export const firstProblem = (problems: SourceProblems): SourceField | null =>
  SOURCE_FIELDS.find((field) => problems[field] !== undefined) ?? null;

/** The messages of a source's fields, in the reader's language. */
export function sourceErrors(t: SourcesT, problems: SourceProblems): Partial<Record<SourceField, string>> {
  const errors: Partial<Record<SourceField, string>> = {};
  for (const field of SOURCE_FIELDS) {
    const key = problems[field];
    if (key !== undefined) errors[field] = t(`errors.${key}`);
  }
  return errors;
}

/** A source as it is sent: a debit by the week has no day of the month. */
export const cleanSource = (form: SourceForm): SourceForm =>
  form.kind === "bank_debit" && form.frequencyUnit === "week" ? { ...form, debitDay: "" } : form;

/** A new source's components: the ones no other fund holds. */
export const freeComponents = (taken: TakenComponents): PayrollComponent[] =>
  PAYROLL_COMPONENTS.filter((component) => taken[component] === undefined);
