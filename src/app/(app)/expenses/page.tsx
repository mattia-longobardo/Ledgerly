import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { withParams } from "@/modules/accounts/ui/controls";
import { expensesView, type TransactionRow as QueryRow } from "@/modules/transactions/queries";
import { displayPayee, isHidden } from "@/modules/transactions/rules";
import { BreakdownCard } from "@/modules/transactions/ui/breakdown-card";
import {
  amountToneOf,
  badgesOf,
  categoryColor,
  categoryColors,
  groupedBreakdown,
  monthLabel,
} from "@/modules/transactions/ui/display";
import { FilterBar } from "@/modules/transactions/ui/filter-bar";
import { filtersOf, parseExpensesQuery, UNCATEGORISED } from "@/modules/transactions/ui/filters";
import { ShortcutsCard } from "@/modules/transactions/ui/shortcuts-card";
import { TransactionsTable } from "@/modules/transactions/ui/transactions-table";
import type {
  AccountFilterOption,
  CategoryFilterOption,
  GroupView,
  RowView,
} from "@/modules/transactions/ui/view";
import { requireSession } from "@/platform/auth/session";
import { today } from "@/platform/dates";
import { formatDate, formatMoney, NULL_DISPLAY } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { ButtonLink } from "@/ui/button";
import { Card } from "@/ui/card";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("expenses"))("title") };
}

/**
 * Expenses (spec §7.2), the screen of the design: the date range with its presets and its
 * two-month picker, the category, account and payee filters, "Show hidden", the table with
 * multiple selection and month groups, and the "By category" card.
 *
 * Every filter lives in the URL and is resolved here, on the server (spec §8.4 point 2), so the
 * page needs no JavaScript to be read and every control is a link or a GET form. Only what a
 * browser must own — the selection, the open category editor, the keyboard cursor — is client
 * state, and it lives in `TransactionsTable`.
 */
export default async function ExpensesPage({ searchParams }: PageProps<"/expenses">) {
  const ctx = await requireSession();
  const t = await getTranslations("expenses");
  const query = parseExpensesQuery(await searchParams, today(ctx.timeZone));
  const view = await expensesView(ctx, filtersOf(query));

  const money = (cents: Cents) => formatMoney(cents, ctx.numberFormat);

  /**
   * One colour per category, decided once: the filter menu, the row chips and the card all read
   * this map, so a category without a colour of its own still looks the same everywhere — and a
   * sub-category always has its group's colour (spec §7.2).
   */
  const colorOf = categoryColors(view.categories);
  const options = view.categories.map((category) => ({
    id: category.id,
    name: category.name,
    color: colorOf.get(category.id) as string,
    depth: category.depth,
  }));
  const categoryCount = new Map(
    view.facets.categories.map((facet) => [facet.categoryId ?? UNCATEGORISED, facet.count]),
  );
  const accountCount = new Map(view.facets.accounts.map((facet) => [facet.accountId, facet.count]));
  const typeCounts = Object.fromEntries(view.facets.types.map((facet) => [facet.type, facet.count]));

  /**
   * The chips show what the range actually holds, plus whatever is selected (so it can be undone).
   * A group counts its sub-categories' movements with its own (F2.5): picking it takes them in.
   */
  const childCount = new Map<string, number>();
  for (const category of view.categories) {
    if (category.parentId === null || category.depth === 0) continue;
    childCount.set(
      category.parentId,
      (childCount.get(category.parentId) ?? 0) + (categoryCount.get(category.id) ?? 0),
    );
  }
  const categoryFilters: CategoryFilterOption[] = options
    .map((option) => ({
      ...option,
      count: (categoryCount.get(option.id) ?? 0) + (childCount.get(option.id) ?? 0),
    }))
    .filter((option) => option.count > 0 || query.categorySelection.includes(option.id));
  const accountFilters: AccountFilterOption[] = view.accounts
    .map((account) => ({
      id: account.id,
      name: account.name,
      count: accountCount.get(account.id) ?? 0,
    }))
    .filter((account) => account.count > 0 || account.id === query.accountId)
    .sort((a, b) => a.name.localeCompare(b.name));

  function toRow(row: QueryRow): RowView {
    return {
      id: row.id,
      date: formatDate(row.on, "long", ctx.locale),
      payee: displayPayee(row.payee),
      account: row.accountName ?? NULL_DISPLAY,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      categoryColor: row.categoryId === null ? null : (colorOf.get(row.categoryId) ?? row.categoryColor),
      amount: money(row.amountCents),
      amountTone: amountToneOf(row),
      badges: badgesOf(row),
      hidden: isHidden(row),
      note: row.note,
      labels: row.labels.map((label) => label.name),
      labelIds: row.labels.map((label) => label.id),
    };
  }

  /** Month headings only mean something in date order; any other sort is one flat list. */
  const groups: GroupView[] =
    query.sort === "date"
      ? view.months.map((month) => ({
          key: month.month,
          label: monthLabel(month.month, ctx.locale),
          count: month.count,
          total: money(month.netCents),
          rows: month.rows.map(toRow),
        }))
      : [
          {
            key: "all",
            label: null,
            count: view.summary.count,
            total: money(view.summary.netCents),
            rows: view.rows.map(toRow),
          },
        ];

  /**
   * The card and the number over it are one answer: `categoryBreakdown` totals the very rows it
   * returns, so the heading can never claim an amount the rows do not hold. The range's own
   * signed total — transfers and income included — belongs to the page header, not here: the card
   * leaves transfers out and measures its rows by size (review B2).
   */
  const breakdown = groupedBreakdown(
    view.breakdown.map((slice) => {
      // An archived category is not in the map: it still takes its group's colour when it has one.
      const parentColor =
        slice.parentId === null ? null : (colorOf.get(slice.parentId) ?? categoryColor(slice.parentColor, 0));
      return {
        id: slice.categoryId ?? UNCATEGORISED,
        name: slice.name ?? t("row.uncategorised"),
        color:
          slice.categoryId === null
            ? "var(--faint)"
            : (colorOf.get(slice.categoryId) ?? parentColor ?? categoryColor(slice.color, 0)),
        cents: slice.totalCents,
        parentId: slice.parentId,
        parentName: slice.parentName,
        parentColor,
      };
    }),
  );

  if (!view.hasAny) {
    return (
      <Page title={t("title")}>
        <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
        <EmptyState
          title={t("unsynced.title")}
          description={t("unsynced.description")}
          actions={
            <ButtonLink href="/settings/integrations" variant="primary">
              {t("unsynced.action")}
            </ButtonLink>
          }
        />
      </Page>
    );
  }

  return (
    <Page title={t("title")}>
      {/* Income, spending and net, never a single signed sum: a giroconto moves money between two
          of the person's own accounts and is neither (spec §7.2, F2.5). What the totals leave out
          is said right under them rather than silently subtracted. */}
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-title font-semibold tracking-[-0.02em]">{t("title")}</h1>
          <p className="text-muted">{t("summary", { count: view.summary.count })}</p>
          <dl aria-label={t("totals.label")} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {(
              [
                ["income", view.summary.incomeCents],
                ["expenses", view.summary.expenseCents],
                ["net", view.summary.netCents],
              ] as const
            ).map(([key, cents]) => (
              <div key={key} className="flex items-baseline gap-1.5">
                <dt className="text-sm text-muted">{t(`totals.${key}`)}</dt>
                <dd className={`font-medium tabular-nums ${TONE_TEXT[toneOfSign(cents)]}`}>
                  {formatMoney(cents, ctx.numberFormat, { signed: key === "net" })}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        {view.summary.transferCount > 0 && (
          <p className="text-sm text-muted">
            {t("totals.transfers", { count: view.summary.transferCount })}
            {view.summary.unpairedTransferCount > 0 &&
              ` · ${t("totals.unpaired", { count: view.summary.unpairedTransferCount })}`}
          </p>
        )}
      </div>

      <FilterBar
        query={query}
        categories={categoryFilters}
        accounts={accountFilters}
        uncategorisedCount={categoryCount.get(UNCATEGORISED) ?? 0}
        typeCounts={typeCounts}
        locale={ctx.locale}
      />

      {/* Two columns from a medium width; past the wide threshold the table takes the extra room,
          which is where the long names are (spec §8.2). A third band for the shortcuts left the
          table narrower on the widest screens, not wider. */}
      <div className="grid items-start gap-6 @4xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] @wide:grid-cols-[minmax(0,9fr)_minmax(0,3fr)]">
        {view.rows.length === 0 ? (
          <EmptyState
            title={t("empty.title")}
            description={t("empty.description")}
            actions={
              <ButtonLink href={withParams("/expenses", query.clearedParams, {})} variant="primary">
                {t("empty.action")}
              </ButtonLink>
            }
          />
        ) : (
          <div className="flex min-w-0 flex-col gap-2">
            <Card padded={false} className="overflow-hidden">
              <TransactionsTable
                groups={groups}
                categories={options}
                labels={view.labels}
                params={query.params}
                sort={query.sort}
                direction={query.direction}
              />
            </Card>
            {/* The read stops at its own page size: say so rather than let the header's count
                disagree with the rows silently (spec §8.4 point 5). It counts against
                `listCount`, the rows the range holds for the list: `summary.count` leaves the
                hidden ones out, and with "Show hidden" on the notice would claim fewer than the
                table is already showing. */}
            {view.truncated && (
              <p className="text-sm text-warn">
                {t("truncated", { shown: view.rows.length, count: view.listCount })}
              </p>
            )}
          </div>
        )}

        {/* The shortcuts are short and fixed; the card below them grows with the categories. */}
        <div className="flex flex-col gap-4">
          <ShortcutsCard />
          <BreakdownCard
            groups={breakdown.groups}
            total={money(breakdown.totalCents)}
            numberFormat={ctx.numberFormat}
          />
        </div>
      </div>
    </Page>
  );
}
