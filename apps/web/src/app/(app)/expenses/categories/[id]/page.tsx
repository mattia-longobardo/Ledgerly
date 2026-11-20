import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { periodEnd, periodMonths } from "@ledgerly/ui/period";
import { PeriodBar } from "@ledgerly/ui/period-bar";
import { dayLabels, monthLabels } from "@ledgerly/ui/chart-labels";
import { budgetDetail } from "@ledgerly/domain/budgets";
import {
  chooseCategoryAction,
  confirmCategoriesAction,
  similarMovementsAction,
  undoCategoriesAction,
} from "@/modules/transactions/categorize/actions";
import { rulesForCategory } from "@ledgerly/domain/transactions";
import { categoryMacroTotals, listTransactions, spendingOverTime } from "@ledgerly/domain/transactions";
import { getCategory, listCategories, listLabels, TaxonomyError } from "@ledgerly/domain/transactions";
import { CategoryActions, type CategoryCommands } from "@/modules/transactions/ui/category-actions";
import { categoryColors, spendingLayers, withMacroTitles } from "@/modules/transactions/ui/display";
import { parseExpensesQuery } from "@/modules/transactions/ui/filters";
import { macroViews } from "@/modules/transactions/ui/macros";
import { SpendingCard } from "@/modules/transactions/ui/spending-card";
import { TransactionsTable } from "@/modules/transactions/ui/transactions-table";
import { changeVisibilityAction } from "../../manual-actions";
import { requireSession } from "@/platform/auth/session";
import { addDays, monthKey, monthsBetween, today } from "@ledgerly/domain/shared/dates";
import { formatDate, formatMoney, formatPercent } from "@ledgerly/domain/platform/format";
import { shiftRange } from "@ledgerly/domain/platform/ranges";
import { Badge } from "@ledgerly/ui/badge";
import { ButtonLink } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import { KpiTile } from "@ledgerly/ui/kpi-tile";
import { Page } from "@ledgerly/ui/shell/page";
import { withParams } from "@ledgerly/ui/url";
import { sourceNotes } from "../../../settings/categories/source";
import { sourceHref } from "../../../settings/integrations/connection-view";
import { rowViewOf } from "../../row-view";
import { RestoreButton } from "./restore-button";

const COMMANDS: CategoryCommands = {
  confirm: confirmCategoriesAction,
  choose: chooseCategoryAction,
  undo: undoCategoriesAction,
  similar: similarMovementsAction,
};

/** The rows of the table on this page (categories-and-rules.md §5.4): the rest is in Expenses. */
const ROWS = 50;

async function categoryOf(userId: string, id: string) {
  try {
    return await getCategory({ userId }, id);
  } catch (error) {
    if (error instanceof TaxonomyError) notFound();
    throw error;
  }
}

export async function generateMetadata({
  params,
}: PageProps<"/expenses/categories/[id]">): Promise<Metadata> {
  const ctx = await requireSession();
  const category = await categoryOf(ctx.userId, (await params).id);
  return { title: `${category.name} · ${(await getTranslations("expenses.categories"))("title")}` };
}

/**
 * The page of one category or group (categories-and-rules.md §5.4): what it spent, received or
 * moved in the period against the period before, its movements, the chart of Expenses on it alone
 * and its budget. The period control is the one of Expenses and of the list of the categories.
 */
export default async function CategoryPage({ params, searchParams }: PageProps<"/expenses/categories/[id]">) {
  const ctx = await requireSession();
  const t = await getTranslations("expenses");
  const raw = await searchParams;
  const todayOn = today(ctx.timeZone);
  const query = parseExpensesQuery(raw, todayOn);
  const category = await categoryOf(ctx.userId, (await params).id);
  const here = `/expenses/categories/${category.id}`;
  const period = { preset: query.params.preset, from: query.params.from, to: query.params.to };
  const carry = { ...period, off: query.params.off, acc: query.params.acc };
  const scope = { accountIds: query.accountSelection, categoryIds: [category.id] };
  const previous = shiftRange(query.range, -1);
  const end = monthKey(periodEnd(query.range, todayOn));

  const [all, labels, totals, before, rows, spending, budget, notes, rules] = await Promise.all([
    listCategories(ctx, { includeArchived: true }),
    listLabels(ctx),
    categoryMacroTotals(ctx, { ...scope, from: query.range.from, to: query.range.to }),
    categoryMacroTotals(ctx, { ...scope, from: previous.from, to: previous.to }),
    listTransactions(ctx, { ...scope, from: query.range.from, to: query.range.to, limit: ROWS }),
    spendingOverTime(
      ctx,
      { ...scope, from: query.range.from, to: query.range.to },
      query.grain,
      category.type,
    ),
    category.type === "expense" ? budgetDetail(ctx, { categoryId: category.id, accountId: null }, end) : null,
    sourceNotes(ctx),
    rulesForCategory(ctx, category.id),
  ]);

  const money = (cents: bigint) => formatMoney(cents, ctx.numberFormat);
  const macroName = t(`categories.macro.${category.type}`);
  const group = category.parentId === null ? null : all.find((one) => one.id === category.parentId);
  const children = all.filter((one) => one.parentId === category.id);
  const ofMacro = (list: typeof totals) => list.filter((row) => row.type === category.type);
  /** What the KPI calls the amount: spent, received, or moved out for a transfer. */
  const amountOf = (list: typeof totals) =>
    ofMacro(list).reduce(
      (sum, row) =>
        sum +
        (category.type === "transfer"
          ? -row.outCents
          : category.type === "expense"
            ? -row.totalCents
            : row.totalCents),
      0n,
    );
  const amount = amountOf(totals);
  const count = ofMacro(totals).reduce((sum, row) => sum + row.count, 0);
  const earlier = amountOf(before);
  const hadBefore = ofMacro(before).some((row) => row.count > 0);
  const { months } = periodMonths(query.range, todayOn);

  const listHref = (macro: string) =>
    withParams("/expenses/categories", carry, { macro: macro === "expense" ? undefined : macro }) as Route;
  const colorOf = categoryColors(all);
  const options = withMacroTitles(
    all
      .filter((one) => one.archivedAt === null)
      .map((one) => ({
        id: one.id,
        name: one.name,
        color: colorOf.get(one.id) as string,
        depth: one.depth,
        type: one.type,
      })),
    {
      income: t("categories.macro.income"),
      expense: t("categories.macro.expense"),
      transfer: t("categories.macro.transfer"),
    },
  );

  // The chart of Expenses, on this category alone.
  const lastDay = query.range.to < todayOn ? query.range.to : todayOn;
  const buckets: string[] = [];
  if (query.grain === "day") {
    for (let day = query.range.from; day <= lastDay; day = addDays(day, 1)) buckets.push(day);
  } else if (query.range.from <= lastDay) {
    buckets.push(...monthsBetween(monthKey(query.range.from), monthKey(lastDay)));
  }
  const layers = spendingLayers(spending, buckets);
  const color = colorOf.get(category.id) ?? "var(--accent)";
  const bands = layers.groups.map((band) => ({
    id: band.id ?? "none",
    name: category.name,
    color,
    values: band.values,
    total: band.total,
  }));

  // Months over the limit inside the period: this one and the history before it.
  const overMonths =
    budget === null
      ? 0
      : [
          { month: end, limitCents: budget.row.limitCents, spentCents: budget.row.spentCents },
          ...budget.history,
        ].filter(
          (one) =>
            one.month >= monthKey(query.range.from) &&
            one.limitCents !== null &&
            one.spentCents > one.limitCents,
        ).length;

  const note = notes.get(category.id);
  const noteHref = note ? sourceHref(note.provider) : null;
  const kpiLabel = t(
    category.type === "income"
      ? "categories.detail.received"
      : category.type === "transfer"
        ? "categories.detail.moved"
        : "categories.detail.spent",
  );
  const delta =
    hadBefore && earlier !== 0n
      ? t("categories.detail.vsPrevious", {
          delta: formatPercent(Number(amount - earlier) / Number(earlier), ctx.numberFormat, {
            signed: true,
          }),
        })
      : undefined;

  const table = (
    <Card padded={false} className="overflow-clip">
      {rows.length === 0 ? (
        <p className="p-4 text-muted">{t("categories.detail.noMovements")}</p>
      ) : (
        <TransactionsTable
          groups={[
            {
              key: "category",
              label: null,
              count: rows.length,
              total: "",
              rows: rows.map((row) => rowViewOf(row, { ctx, colorOf, categories: options })),
            },
          ]}
          categories={options}
          labels={labels}
          params={carry}
          sort="date"
          direction="desc"
          path={here}
          sortable={false}
          visibility={changeVisibilityAction}
        />
      )}
    </Card>
  );

  // The categories of a group, with their totals in the period (§5.4): the list of the page.
  const groupLines =
    children.length === 0
      ? []
      : (macroViews(
          all.map((one) => ({
            id: one.id,
            name: one.name,
            parentId: one.parentId,
            type: one.type,
            archived: one.archivedAt !== null,
          })),
          totals,
        )
          .find((view) => view.macro === category.type)
          ?.groups.find((line) => line.category.id === category.id)?.children ?? []);

  return (
    <CategoryActions commands={COMMANDS} categories={options}>
      <Page title={category.name} parent={{ href: listHref(category.type), label: t("categories.title") }}>
        <div className="flex flex-col gap-1">
          <nav
            aria-label={t("categories.detail.path")}
            className="flex flex-wrap items-center gap-1 text-sm text-muted"
          >
            <Link
              href={listHref(category.type)}
              className="focus-ring inline-flex min-h-6 items-center rounded-xs hover:underline"
            >
              {macroName}
            </Link>
            {group && (
              <>
                <span aria-hidden>›</span>
                <Link
                  href={`/expenses/categories/${group.id}${withParams("", carry, {})}` as Route}
                  className="focus-ring inline-flex min-h-6 items-center rounded-xs hover:underline"
                >
                  {group.name}
                </Link>
              </>
            )}
          </nav>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-title font-semibold tracking-title">{category.name}</h1>
            {category.archivedAt !== null && (
              <>
                <Badge tone="neutral">{t("categories.detail.archived")}</Badge>
                <RestoreButton id={category.id} />
              </>
            )}
          </div>
          {note && note.names.length > 0 && (
            <p className="text-sm text-muted">
              {noteHref === null ? (
                t("categories.source", { provider: note.source, names: note.names.join(", ") })
              ) : (
                <Link href={noteHref as Route} className="focus-ring rounded-xs hover:underline">
                  {t("categories.source", { provider: note.source, names: note.names.join(", ") })}
                </Link>
              )}
            </p>
          )}
        </div>

        <PeriodBar
          period={{ preset: query.preset, offset: query.offset, range: query.range, stepperParams: period }}
          path={here}
          carry={{ acc: carry.acc }}
          locale={ctx.locale}
        />

        <div className="grid grid-cols-2 gap-3 @4xl:grid-cols-4">
          <KpiTile label={kpiLabel} value={money(amount)} delta={delta} />
          <KpiTile label={t("categories.detail.count")} value={String(count)} />
          {months >= 2 && (
            <KpiTile label={t("categories.detail.perMonth")} value={money(amount / BigInt(months))} />
          )}
          {budget && (
            <Card className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm font-medium text-muted">{t("categories.detail.budget")}</span>
              <span className="text-lg font-semibold">
                {t("categories.detail.budgetLimit", { limit: money(budget.row.limitCents) })}
              </span>
              <span className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
                {t("categories.detail.overMonths", { count: overMonths })}
                <Link
                  href={"/budgets" as Route}
                  className="focus-ring inline-flex min-h-6 items-center rounded-xs text-accent hover:underline"
                >
                  {t("categories.detail.openBudgets")}
                </Link>
              </span>
            </Card>
          )}
        </div>

        <SpendingCard
          bands={bands}
          totals={layers.totals}
          labels={buckets.map((bucket) =>
            formatDate(bucket, query.grain === "day" ? "long" : "monthYear", ctx.locale),
          )}
          xLabels={query.grain === "day" ? dayLabels(buckets, ctx.locale) : monthLabels(buckets, ctx.locale)}
          grain={query.grain}
          path={here}
          params={carry}
          numberFormat={ctx.numberFormat}
          kind={category.type}
        />

        {groupLines.length > 0 && (
          <Card padded={false}>
            <h2 className="px-4 pt-3 text-lg font-semibold">{t("categories.detail.categories")}</h2>
            <ul className="flex flex-col">
              {groupLines.map((line) => (
                <li
                  key={line.category.id}
                  className="flex items-center gap-3 border-t border-border px-4 py-2 first:border-0"
                >
                  <Link
                    href={`/expenses/categories/${line.category.id}${withParams("", carry, {})}` as Route}
                    className="focus-ring inline-flex min-h-6 min-w-0 flex-1 items-center truncate rounded-xs hover:underline"
                  >
                    {line.category.name}
                  </Link>
                  <span className="tabular-nums">{money(line.totalCents)}</span>
                  <span className="w-12 text-right text-sm text-muted tabular-nums">
                    {formatPercent(line.share / 100, ctx.numberFormat)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <div className="grid grid-cols-1 items-start gap-4 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <section aria-labelledby="category-movements" className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="category-movements" className="text-lg font-semibold">
                {t("categories.detail.movements")}
              </h2>
              <ButtonLink size="sm" href={withParams("/expenses", carry, { cat: category.id }) as Route}>
                {t("categories.detail.openInExpenses")}
              </ButtonLink>
            </div>
            {table}
          </section>
          {/* The rules that give this category (categories-and-rules.md §5.4). */}
          <Card className="flex min-w-0 flex-col gap-2">
            <h2 id="category-rules" className="text-lg font-semibold">
              {t("categories.detail.rules")}
            </h2>
            {rules.length === 0 ? (
              <p className="text-sm text-muted">{t("categories.detail.noRules")}</p>
            ) : (
              <ul aria-labelledby="category-rules" className="flex flex-col gap-1">
                {rules.map((rule) => (
                  <li key={rule.id} className="flex items-center gap-2">
                    <Link
                      href={`/settings/rules#rule-${rule.id}` as Route}
                      className="focus-ring inline-flex min-h-6 min-w-0 items-center truncate rounded-xs hover:underline"
                    >
                      «{rule.name}» → {category.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {category.archivedAt === null && (
              <ButtonLink
                size="sm"
                className="self-start"
                href={`/settings/rules?category=${category.id}` as Route}
              >
                ＋ {t("categories.detail.newRule")}
              </ButtonLink>
            )}
          </Card>
        </div>
      </Page>
    </CategoryActions>
  );
}
