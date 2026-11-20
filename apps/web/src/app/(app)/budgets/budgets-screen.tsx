"use client";

// Budgets (spec §7.3), read from `/api/v1` (rewrite plan R3): the month the stepper shows (`off` months
// back from the current one; the stepper never walks into the future), with every total a field of
// `GET /budgets/view`. The screen formats; it adds nothing up.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { budgets } from "@ledgerly/api-contract/budgets";
import { profile } from "@ledgerly/api-contract/settings";
import type { RouteOutput } from "@ledgerly/api-client";
import { parseCents } from "@ledgerly/format/cents";
import { addMonths, lastDayOfMonth, monthKey, today } from "@ledgerly/format/dates";
import {
  formatDate,
  formatMoney,
  formatWholePercent,
  type NumberFormat,
  numberStyle,
  type UiLocale,
} from "@ledgerly/format/format";
import { Card } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { useApi, useLatest } from "@ledgerly/ui/data";
import { PeriodStepper } from "@ledgerly/ui/link-controls";
import { Loaded } from "@ledgerly/ui/loaded";
import { ProgressBar } from "@ledgerly/ui/progress-bar";
import { Page } from "@ledgerly/ui/shell/page";
import { Stat } from "@ledgerly/ui/stat";
import { EmptyState } from "@ledgerly/ui/states";
import { TONE_TEXT } from "@ledgerly/ui/tone";
import { AddBudget, BudgetsTable, NO_COLOR, rowViewOf } from "@/modules/budgets/client";

type View = RouteOutput<typeof budgets.getBudgetsView>;
interface Format {
  locale: UiLocale;
  numberFormat: NumberFormat;
}

/** How many months back the stepper is: `off`, a whole number from 0. */
const offsetOf = (value: string | null) => Math.max(0, Math.floor(Number(value ?? 0)) || 0);

function AddButton({ view, monthLabel, label }: { view: View; monthLabel: string; label: string }) {
  return (
    <AddBudget
      month={view.month}
      monthLabel={monthLabel}
      categories={view.categories.map((one) => ({ ...one, color: one.color ?? NO_COLOR }))}
      accounts={view.accounts}
      variant="primary"
      label={label}
    />
  );
}

/** The line under the total's bar: what is out of every budget, and what waits for a category. */
function TotalNotes({
  view,
  monthLabel,
  money,
}: {
  view: View;
  monthLabel: string;
  money: (amount: string) => string;
}) {
  const text = useTranslations("budgets");
  return (
    <>
      {parseCents(view.unbudgeted) > 0n && (
        <p className="text-sm text-muted">{text("total.unbudgeted", { amount: money(view.unbudgeted) })}</p>
      )}
      {view.toCategorise.count > 0 && (
        <p className="text-sm text-muted">
          {text("total.toCategorise", {
            count: view.toCategorise.count,
            month: monthLabel,
            amount: money(view.toCategorise.amount),
          })}{" "}
          <Link
            href={`/expenses/review?from=${view.month}&to=${lastDayOfMonth(view.month)}`}
            className="focus-ring inline-flex min-h-6 items-center font-medium text-accent hover:underline"
          >
            {text("total.review")}
          </Link>
        </p>
      )}
    </>
  );
}

/** The month's total: its bar, what is left or over, and the two figures. */
function TotalCard({ view, monthLabel, format }: { view: View; monthLabel: string; format: Format }) {
  const text = useTranslations("budgets");
  const money = (amount: string) => formatMoney(parseCents(amount), format.numberFormat);
  const remaining = parseCents(view.totals.remaining);
  const over = remaining < 0n;
  return (
    <Card className="grid gap-4 @2xl:grid-cols-[1fr_auto] @2xl:items-center">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold">{text("total.title")}</span>
          <span className={cn("text-sm tabular-nums", over ? TONE_TEXT.neg : "text-muted")}>
            {over
              ? text("total.over", { amount: formatMoney(-remaining, format.numberFormat) })
              : text("total.remaining", { amount: formatMoney(remaining, format.numberFormat) })}
          </span>
        </div>
        <ProgressBar
          value={view.totals.percent / 100}
          tone={over ? "neg" : "accent"}
          label={text("total.progress")}
        />
        <TotalNotes view={view} monthLabel={monthLabel} money={money} />
      </div>
      <dl className="flex gap-8">
        <Stat label={text("total.spent")} value={money(view.totals.spent)} size="kpi" />
        <Stat label={text("total.limit")} value={money(view.totals.limit)} size="kpi" />
      </dl>
    </Card>
  );
}

function BudgetsList({ view, monthLabel, format }: { view: View; monthLabel: string; format: Format }) {
  const text = useTranslations("budgets");
  const labels = { allCategories: text("allCategories"), allAccounts: text("allAccounts") };
  return (
    <>
      <TotalCard view={view} monthLabel={monthLabel} format={format} />
      <Card padded={false} className="max-md:px-4">
        <BudgetsTable
          rows={view.budgets.map((line) => rowViewOf(line, format.numberFormat, labels))}
          month={view.month}
          monthLabel={monthLabel}
        />
      </Card>
      <p className="text-sm text-faint max-md:hidden">{text("hint")}</p>
    </>
  );
}

function BudgetsView({ view, offset, format }: { view: View; offset: number; format: Format }) {
  const text = useTranslations("budgets");
  const monthLabel = formatDate(view.month, "monthYear", format.locale);
  const { limit, spent, percent } = view.totals;
  const empty = view.budgets.length === 0;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-title font-semibold tracking-title max-md:sr-only">{text("title")}</h1>
          {!empty && (
            <p className="text-muted tabular-nums">
              {text("summary", {
                spent: formatMoney(parseCents(spent), format.numberFormat),
                limit: formatMoney(parseCents(limit), format.numberFormat, { decimals: false }),
                percent: formatWholePercent(percent, format.numberFormat),
              })}
            </p>
          )}
        </div>
        <PeriodStepper
          label={text("period.label")}
          path="/budgets"
          params={{ off: offset ? String(offset) : undefined }}
          offset={offset}
          periodLabel={monthLabel}
          previousLabel={text("period.previous")}
          nextLabel={text("period.next")}
          latestLabel={text("period.latest")}
        />
      </div>
      {empty ? (
        <EmptyState
          title={text("empty.title")}
          description={text("empty.description")}
          actions={<AddButton view={view} monthLabel={monthLabel} label={text("empty.cta")} />}
        />
      ) : (
        <BudgetsList view={view} monthLabel={monthLabel} format={format} />
      )}
    </>
  );
}

/**
 * The Budgets page: the month of the stepper, read from `/api/v1`. The month is the person's, so it is
 * known once the preferences are; until then the route answers its own current month.
 */
export function BudgetsScreen() {
  const text = useTranslations("budgets");
  const offset = offsetOf(useSearchParams().get("off"));
  const prefs = useApi(profile.getPreferences, {}).data;
  const month = prefs ? addMonths(monthKey(today(prefs.timeZone)), -offset) : undefined;
  // A step of the month keeps the month before on screen until the next one answers.
  const read = useLatest(useApi(budgets.getBudgetsView, { query: { month } }));
  const view = read.data;
  const format = prefs && { locale: prefs.locale, numberFormat: numberStyle(prefs) };
  const actions = view && format && (
    <AddButton
      view={view}
      monthLabel={formatDate(view.month, "monthYear", format.locale)}
      label={text("add")}
    />
  );
  return (
    <Page title={text("title")} actions={actions}>
      <Loaded state={read}>
        {(loaded) => format && <BudgetsView view={loaded} offset={offset} format={format} />}
      </Loaded>
    </Page>
  );
}
