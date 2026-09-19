import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { budgetsView } from "@/modules/budgets/queries";
import { AddBudget } from "@/modules/budgets/ui/add-budget";
import { BudgetsTable } from "@/modules/budgets/ui/budgets-table";
import { presentRows } from "@/modules/budgets/ui/present";
import { PeriodStepper } from "@/modules/accounts/ui/controls";
import { percentOf } from "@/modules/budgets/rules";
import { requireSession } from "@/platform/auth/session";
import { addMonths, monthKey, today } from "@/platform/dates";
import { formatDate, formatMoney, formatWholePercent } from "@/platform/format";
import { Card } from "@/ui/card";
import { cn } from "@/ui/cn";
import { ProgressBar } from "@/ui/progress-bar";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";
import { TONE_TEXT } from "@/ui/tone";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("budgets"))("title") };
}

/**
 * Budgets (spec §7.3): monthly limits per category for the month the stepper shows (`off` months
 * back from the current one; the stepper never walks into the future, like the design's "October
 * has no data yet").
 */
export default async function BudgetsPage({ searchParams }: PageProps<"/budgets">) {
  const ctx = await requireSession();
  const t = await getTranslations("budgets");
  const query = await searchParams;
  const offset = Math.max(0, Math.floor(Number(query.off ?? 0)) || 0);
  const month = addMonths(monthKey(today(ctx.timeZone)), -offset);
  const monthLabel = formatDate(month, "monthYear", ctx.locale);
  const view = await budgetsView(ctx, month);
  const money = (cents: bigint) => formatMoney(cents, ctx.numberFormat);

  const add = (variant: "primary" | "secondary", label: string) => (
    <AddBudget
      month={month}
      monthLabel={monthLabel}
      categories={view.categories}
      accounts={view.accounts}
      variant={variant}
      label={label}
    />
  );
  const stepper = (
    <PeriodStepper
      label={t("period.label")}
      path="/budgets"
      params={{ off: offset ? String(offset) : undefined }}
      offset={offset}
      periodLabel={monthLabel}
      previousLabel={t("period.previous")}
      nextLabel={t("period.next")}
      latestLabel={t("period.latest")}
    />
  );

  const { limitCents, spentCents } = view.totals;
  const totalPercent = percentOf(spentCents, limitCents);
  const over = spentCents > limitCents;

  return (
    <Page title={t("title")} actions={add("primary", t("add"))}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
          {view.rows.length > 0 && (
            <p className="text-muted tabular-nums">
              {t("summary", {
                spent: money(spentCents),
                limit: formatMoney(limitCents, ctx.numberFormat, { decimals: false }),
                percent: formatWholePercent(totalPercent, ctx.numberFormat),
              })}
            </p>
          )}
        </div>
        {stepper}
      </div>

      {view.rows.length === 0 ? (
        <EmptyState
          title={t("empty.title")}
          description={t("empty.description")}
          actions={add("primary", t("empty.cta"))}
        />
      ) : (
        <>
          <Card className="grid gap-4 @2xl:grid-cols-[1fr_auto] @2xl:items-center">
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{t("total.title")}</span>
                <span className={cn("text-sm tabular-nums", over ? TONE_TEXT.neg : "text-muted")}>
                  {over
                    ? t("total.over", { amount: money(spentCents - limitCents) })
                    : t("total.remaining", { amount: money(limitCents - spentCents) })}
                </span>
              </div>
              <ProgressBar
                value={totalPercent / 100}
                tone={over ? "neg" : "accent"}
                label={t("total.progress")}
              />
              {view.unbudgetedCents > 0n && (
                <p className="text-sm text-muted">
                  {t("total.unbudgeted", { amount: money(view.unbudgetedCents) })}
                </p>
              )}
            </div>
            <dl className="flex gap-8">
              <div className="flex flex-col">
                <dt className="text-sm text-muted">{t("total.spent")}</dt>
                <dd className="text-kpi font-semibold tabular-nums">{money(spentCents)}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-sm text-muted">{t("total.limit")}</dt>
                <dd className="text-kpi font-semibold tabular-nums">{money(limitCents)}</dd>
              </div>
            </dl>
          </Card>

          <Card padded={false} className="max-md:px-4">
            <BudgetsTable
              rows={presentRows(view.rows, ctx.numberFormat, {
                allCategories: t("allCategories"),
                allAccounts: t("allAccounts"),
              })}
              month={month}
              monthLabel={monthLabel}
            />
          </Card>
          <p className="text-sm text-faint max-md:hidden">{t("hint")}</p>
        </>
      )}
    </Page>
  );
}
