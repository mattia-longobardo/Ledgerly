"use client";

// The blocks of Expenses once `GET /transactions/view` has answered: the totals, the filters, the
// review notice, the two cards and the table. Every number is a field of a route; here it is formatted.
import { useTranslations } from "next-intl";
import { accounts as accountRoutes } from "@ledgerly/api-contract/accounts";
import { movements, spending } from "@ledgerly/api-contract/transactions";
import type { RouteOutput } from "@ledgerly/api-client";
import { parseCents } from "@ledgerly/format/cents";
import { monthKey } from "@ledgerly/format/dates";
import {
  formatDate,
  formatMoney,
  NULL_DISPLAY,
  type NumberFormat,
  type UiLocale,
} from "@ledgerly/format/format";
import { ButtonLink } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import type { CategoryOption } from "@ledgerly/ui/category-picker";
import { dayLabels, monthLabels } from "@ledgerly/ui/chart-labels";
import { Page } from "@ledgerly/ui/shell/page";
import { EmptyState } from "@ledgerly/ui/states";
import { TONE_TEXT, toneOfSign } from "@ledgerly/ui/tone";
import { withParams } from "@ledgerly/ui/url";
import { categoryColor } from "@/modules/transactions";
import {
  type AccountFilterOption,
  AddMovementButton,
  BreakdownCard,
  type BreakdownGroup,
  type CategoryFilterOption,
  type ExpensesQuery,
  FilterBar,
  type GroupView,
  lineViewOf,
  monthLabel,
  routeFiltersOf,
  ShortcutsCard,
  SpendingCard,
  type TransactionLine,
  TransactionsTable,
  UNCATEGORISED,
} from "@/modules/transactions/client";
import { ExpensesTabs } from "./tabs";

type View = RouteOutput<typeof movements.getTransactionsView>;
type Breakdown = RouteOutput<typeof spending.getSpendingBreakdown>;
type Series = RouteOutput<typeof spending.getSpendingSeries>;
type Account = RouteOutput<typeof accountRoutes.listAccounts>["accounts"][number];

/** The four reads of the screen, drawn together once they all have an answer. */
export interface Reads {
  view: View;
  series: Series;
  breakdown: Breakdown;
  accounts: readonly Account[];
}

/** What every block of the screen reads: the address, the routes' filters, the format, the categories. */
export interface Screen {
  query: ExpensesQuery;
  filters: ReturnType<typeof routeFiltersOf>;
  locale: UiLocale;
  numberFormat: NumberFormat;
  colorOf: ReadonlyMap<string, string>;
  categories: readonly { id: string; parentId: string | null; depth: 0 | 1 }[];
  options: readonly (CategoryOption & { depth: 0 | 1 })[];
  pickerOptions: readonly CategoryOption[];
  labels: readonly { id: string; name: string; color: string | null }[];
}

const money = (amount: string, screen: Screen) => formatMoney(parseCents(amount), screen.numberFormat);

export function Movements({ reads, screen }: { reads: Reads; screen: Screen }) {
  const text = useTranslations("expenses");
  const { view } = reads;
  const { query } = screen;
  return (
    <Page title={text("title")} actions={<AddMovementButton short />}>
      <Totals view={view} screen={screen} />
      <ExpensesTabs
        current="movements"
        params={{
          preset: query.params.preset,
          from: query.params.from,
          to: query.params.to,
          off: query.params.off,
          acc: query.params.acc,
        }}
      />
      <Filters view={view} accounts={reads.accounts} screen={screen} />
      {view.review.count > 0 && <ReviewNotice view={view} screen={screen} />}
      <SpendingChart series={reads.series} screen={screen} />
      {/* Two columns from a medium width; past the wide threshold the table takes the extra room,
          which is where the long names are (spec §8.2). */}
      <div className="grid items-start gap-6 @4xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] @wide:grid-cols-[minmax(0,9fr)_minmax(0,3fr)]">
        {view.rows.length === 0 ? (
          <EmptyState
            title={text("empty.title")}
            description={text("empty.description")}
            actions={
              <ButtonLink href={withParams("/expenses", query.clearedParams, {})} variant="primary">
                {text("empty.action")}
              </ButtonLink>
            }
          />
        ) : (
          <Table view={view} screen={screen} />
        )}
        {/* The shortcuts are short and fixed; the card below them grows with the categories. */}
        <div className="flex flex-col gap-4">
          <ShortcutsCard />
          <Categories breakdown={reads.breakdown} screen={screen} />
        </div>
      </div>
    </Page>
  );
}

/**
 * Income and spending leave the giroconti out: moving money between two of the person's own
 * accounts is neither (spec §7.2, F2.5). The net is the cash flow, every movement summed. What the
 * totals leave out is said right under them.
 */
function Totals({ view, screen }: { view: View; screen: Screen }) {
  const text = useTranslations("expenses");
  const { summary } = view;
  const totals = [
    ["income", summary.income],
    ["expenses", summary.expense],
    ["net", summary.net],
  ] as const;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-title font-semibold tracking-title">{text("title")}</h1>
        <p className="text-muted">{text("summary", { count: summary.count })}</p>
        <dl aria-label={text("totals.label")} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {totals.map(([key, amount]) => (
            <div key={key} className="flex items-baseline gap-1.5">
              <dt className="text-sm text-muted">{text(`totals.${key}`)}</dt>
              <dd className={`font-medium tabular-nums ${TONE_TEXT[toneOfSign(parseCents(amount))]}`}>
                {formatMoney(parseCents(amount), screen.numberFormat, { signed: key === "net" })}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {summary.transferCount > 0 && (
        <p className="text-sm text-muted">
          {text("totals.transfers", { count: summary.transferCount })}
          {summary.unpairedTransferCount > 0 &&
            ` · ${text("totals.unpaired", { count: summary.unpairedTransferCount })}`}
        </p>
      )}
    </div>
  );
}

function Filters({ view, accounts, screen }: { view: View; accounts: readonly Account[]; screen: Screen }) {
  const uncategorised = view.facets.categories.find((facet) => facet.categoryId === null);
  return (
    <FilterBar
      query={screen.query}
      categories={categoryFiltersOf(view, screen)}
      accounts={accountFiltersOf(view, accounts, screen.query)}
      uncategorisedCount={uncategorised?.count ?? 0}
      typeCounts={Object.fromEntries(view.facets.types.map((facet) => [facet.type, facet.count]))}
      locale={screen.locale}
    />
  );
}

/**
 * The chips show what the range actually holds, plus whatever is selected (so it can be undone).
 * A group counts its sub-categories' movements with its own (F2.5): picking it takes them in.
 */
function categoryFiltersOf(view: View, { options, query }: Screen): CategoryFilterOption[] {
  const counted = new Map(
    view.facets.categories.map((facet) => [facet.categoryId ?? UNCATEGORISED, facet.count]),
  );
  const groups = new Map(view.facets.groups.map((facet) => [facet.categoryId, facet.count]));
  return options
    .map((option) => ({ ...option, count: groups.get(option.id) ?? counted.get(option.id) ?? 0 }))
    .filter((option) => option.count > 0 || query.categorySelection.includes(option.id));
}

function accountFiltersOf(
  view: View,
  accounts: readonly { id: string; name: string }[],
  query: ExpensesQuery,
): AccountFilterOption[] {
  const counted = new Map(view.facets.accounts.map((facet) => [facet.accountId, facet.count]));
  return accounts
    .map((account) => ({ id: account.id, name: account.name, count: counted.get(account.id) ?? 0 }))
    .filter((account) => account.count > 0 || query.accountSelection.includes(account.id))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function ReviewNotice({ view, screen }: { view: View; screen: Screen }) {
  const text = useTranslations("expenses");
  const { query } = screen;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-ctl bg-hover px-3 py-2 text-sm">
      <p>
        {text("review.notice.expenses", {
          count: view.review.count,
          amount: money(view.review.amount, screen),
        })}
        {view.review.suggested > 0 && ` ${text("review.notice.suggested", { count: view.review.suggested })}`}
      </p>
      <ButtonLink
        size="sm"
        className="max-sm:w-full"
        href={withParams(
          "/expenses/review",
          {},
          {
            from: query.range.from,
            to: query.range.to,
            acc: query.accountSelection.length > 0 ? query.accountSelection.join(",") : undefined,
          },
        )}
      >
        {text("review.notice.action")}
      </ButtonLink>
    </div>
  );
}

function SpendingChart({ series, screen }: { series: Series; screen: Screen }) {
  const text = useTranslations("expenses");
  const { query, locale, colorOf } = screen;
  const buckets = series.buckets.map((one) => one.bucket);
  return (
    <SpendingCard
      bands={series.groups.map((group) => ({
        id: group.id ?? UNCATEGORISED,
        name: group.id === null ? text("row.uncategorised") : (group.name ?? NULL_DISPLAY),
        // The group's colour, the one its chips and its card row have too.
        color: group.id === null ? "var(--faint)" : (colorOf.get(group.id) ?? categoryColor(group.color, 0)),
        values: group.values.map(parseCents),
        total: parseCents(group.total),
        share: group.share,
      }))}
      total={parseCents(series.total)}
      totals={series.buckets.map((one) => parseCents(one.total))}
      labels={buckets.map((bucket) =>
        formatDate(bucket, query.grain === "day" ? "long" : "monthYear", locale),
      )}
      xLabels={query.grain === "day" ? dayLabels(buckets, locale) : monthLabels(buckets, locale)}
      grain={query.grain}
      path="/expenses"
      params={query.params}
      numberFormat={screen.numberFormat}
    />
  );
}

/**
 * The «By category» card: `total` is what its bars add up to, so the heading never claims an amount
 * the rows do not hold. The page header keeps the range's own signed total (review B2).
 */
function Categories({ breakdown, screen }: { breakdown: Breakdown; screen: Screen }) {
  const text = useTranslations("expenses");
  return (
    <BreakdownCard
      groups={barsOf(breakdown, screen, text("row.uncategorised"))}
      total={money(breakdown.total, screen)}
    />
  );
}

function barsOf(breakdown: Breakdown, screen: Screen, uncategorised: string): BreakdownGroup[] {
  type Bar = Breakdown["groups"][number]["children"][number];
  // A sub-category not in the map (archived) takes its group's colour.
  const bar = (one: Bar, groupColor: string | null) => ({
    id: one.id ?? UNCATEGORISED,
    name: one.name ?? uncategorised,
    color:
      one.id === null
        ? "var(--faint)"
        : (screen.colorOf.get(one.id) ?? groupColor ?? categoryColor(one.color, 0)),
    amount: money(one.signedAmount, screen),
    share: one.share,
    width: one.width,
  });
  return breakdown.groups.map((group) => {
    const head = bar(group, null);
    return { ...head, children: group.children.map((child) => bar(child, head.color)) };
  });
}

function Table({ view, screen }: { view: View; screen: Screen }) {
  const text = useTranslations("expenses");
  const { query } = screen;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Card padded={false} className="overflow-clip">
        <TransactionsTable
          groups={groupsOf(view, screen)}
          categories={screen.pickerOptions}
          labels={screen.labels}
          params={query.params}
          sort={query.sort}
          direction={query.direction}
        />
      </Card>
      {/* The read stops at its own page size: say so rather than let the header's count disagree
          with the rows silently (spec §8.4 point 5). `listCount` counts the hidden rows "Show
          hidden" puts on screen; `summary.count` leaves them out. */}
      {view.truncated && (
        <p className="text-sm text-warn">
          {text("truncated", { shown: view.rows.length, count: view.listCount })}
        </p>
      )}
    </div>
  );
}

/** Month headings only mean something in date order; any other sort is one flat list. */
function groupsOf(view: View, screen: Screen): GroupView[] {
  const row = (line: TransactionLine) => lineViewOf(line, { ...screen, categories: screen.options });
  if (screen.query.sort !== "date")
    return [
      {
        key: "all",
        label: null,
        count: view.summary.count,
        total: money(view.summary.net, screen),
        rows: view.rows.map(row),
      },
    ];
  const byMonth = new Map<string, TransactionLine[]>();
  for (const line of view.rows) {
    const month = byMonth.get(monthKey(line.on)) ?? [];
    month.push(line);
    byMonth.set(monthKey(line.on), month);
  }
  return view.months.map((month) => ({
    key: month.month,
    label: monthLabel(month.month, screen.locale),
    count: month.count,
    total: money(month.net, screen),
    rows: (byMonth.get(month.month) ?? []).map(row),
  }));
}
