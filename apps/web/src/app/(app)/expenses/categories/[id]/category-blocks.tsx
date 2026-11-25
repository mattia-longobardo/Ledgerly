"use client";

// The blocks of a category's page once its routes have answered: the heading, the tiles, the chart,
// the sub-categories, the movements and the rules. Every number is a field of a route.
import { useTranslations } from "next-intl";
import {
  categories as categoryRoutes,
  labels as labelRoutes,
  profile,
} from "@ledgerly/api-contract/settings";
import { movements, rules as ruleRoutes, spending } from "@ledgerly/api-contract/transactions";
import type { RouteOutput } from "@ledgerly/api-client";
import { parseCents } from "@ledgerly/format/cents";
import { formatDate, formatMoney, formatPercent, type NumberFormat } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { ButtonLink } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import type { CategoryOption } from "@ledgerly/ui/category-picker";
import { dayLabels, monthLabels } from "@ledgerly/ui/chart-labels";
import type { ApiState } from "@ledgerly/ui/data";
import { KpiTile } from "@ledgerly/ui/kpi-tile";
import { Loaded } from "@ledgerly/ui/loaded";
import { Link } from "@ledgerly/ui/router";
import type { Params } from "@ledgerly/ui/url";
import { withParams } from "@ledgerly/ui/url";
import {
  type ExpensesQuery,
  lineViewOf,
  SpendingCard,
  TransactionsTable,
  sourcePageOf,
  useSourcesOff,
} from "@/modules/transactions/client";
import { RestoreButton } from "./restore-button";

export type Category = RouteOutput<typeof categoryRoutes.listCategories>["categories"][number];
type Summary = RouteOutput<typeof categoryRoutes.getCategorySummary>;
type Series = RouteOutput<typeof spending.getSpendingSeries>;
type View = RouteOutput<typeof movements.getTransactionsView>;
type RuleList = RouteOutput<typeof ruleRoutes.listRules>;

/** What every block of the page reads: the category, the address, the format, the pickers' options. */
export interface CategoryPage {
  category: Category;
  group: Category | null;
  query: ExpensesQuery;
  here: string;
  carry: Params;
  prefs: RouteOutput<typeof profile.getPreferences>;
  numberFormat: NumberFormat;
  colorOf: ReadonlyMap<string, string>;
  options: readonly (CategoryOption & { section: string })[];
  labels: RouteOutput<typeof labelRoutes.listLabels>["labels"];
  listHref: (macro: string) => string;
}

const money = (amount: string, page: CategoryPage) => formatMoney(parseCents(amount), page.numberFormat);
const linkClass = "focus-ring inline-flex min-h-6 items-center rounded-xs hover:underline";

export function CategoryHeading({ page, source }: { page: CategoryPage; source: Summary["source"] }) {
  const text = useTranslations("expenses");
  const { category, group, carry } = page;
  // A plugin that is off leaves nothing to match: its line is hidden (PERS-615 §4).
  const off = useSourcesOff().providers;
  const note =
    source && source.names.length > 0 && !off.has(source.provider)
      ? text("categories.source", { provider: source.name, names: source.names.join(", ") })
      : null;
  return (
    <div className="flex flex-col gap-1">
      <nav
        aria-label={text("categories.detail.path")}
        className="flex flex-wrap items-center gap-1 text-sm text-muted"
      >
        <Link href={page.listHref(category.type)} className={linkClass}>
          {text(`categories.macro.${category.type}`)}
        </Link>
        {group && (
          <>
            <span aria-hidden>›</span>
            <Link href={`/expenses/categories/${group.id}${withParams("", carry, {})}`} className={linkClass}>
              {group.name}
            </Link>
          </>
        )}
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-title font-semibold tracking-title">{category.name}</h1>
        {category.archivedAt !== null && (
          <>
            <Badge tone="neutral">{text("categories.detail.archived")}</Badge>
            <RestoreButton id={category.id} />
          </>
        )}
      </div>
      {source && note !== null && (
        <p className="text-sm text-muted">
          <Link href={sourcePageOf(source.provider)} className="focus-ring rounded-xs hover:underline">
            {note}
          </Link>
        </p>
      )}
    </div>
  );
}

export function Tiles({ summary, page }: { summary: Summary; page: CategoryPage }) {
  const text = useTranslations("expenses");
  const type = page.category.type;
  const kpiLabel = text(type === "income" ? "categories.detail.received" : "categories.detail.spent");
  const delta =
    summary.change === null
      ? undefined
      : text("categories.detail.vsPrevious", {
          delta: formatPercent(summary.change, page.numberFormat, { signed: true }),
        });
  return (
    <div className="grid grid-cols-2 gap-3 @4xl:grid-cols-4">
      <KpiTile label={kpiLabel} value={money(summary.amount, page)} delta={delta} />
      <KpiTile label={text("categories.detail.count")} value={String(summary.count)} />
      {summary.perMonth !== null && (
        <KpiTile label={text("categories.detail.perMonth")} value={money(summary.perMonth, page)} />
      )}
      {summary.budget && (
        <Card className="flex min-w-0 flex-col gap-1.5">
          <span className="text-sm font-medium text-muted">{text("categories.detail.budget")}</span>
          <span className="text-lg font-semibold">
            {text("categories.detail.budgetLimit", { limit: money(summary.budget.limit, page) })}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
            {text("categories.detail.overMonths", { count: summary.budget.overMonths })}
            <Link href="/budgets" className={`${linkClass} text-accent`}>
              {text("categories.detail.openBudgets")}
            </Link>
          </span>
        </Card>
      )}
    </div>
  );
}

/** The chart of Expenses, on this category alone. */
export function Spending({ series, page }: { series: Series; page: CategoryPage }) {
  const { category, query, prefs } = page;
  const buckets = series.buckets.map((one) => one.bucket);
  const color = page.colorOf.get(category.id) ?? "var(--accent)";
  return (
    <SpendingCard
      bands={series.groups.map((band) => ({
        id: band.id ?? "none",
        name: category.name,
        color,
        values: band.values.map(parseCents),
        total: parseCents(band.total),
        share: band.share,
      }))}
      total={parseCents(series.total)}
      totals={series.buckets.map((one) => parseCents(one.total))}
      labels={buckets.map((bucket) =>
        formatDate(bucket, query.grain === "day" ? "long" : "monthYear", prefs.locale),
      )}
      xLabels={query.grain === "day" ? dayLabels(buckets, prefs.locale) : monthLabels(buckets, prefs.locale)}
      grain={query.grain}
      path={page.here}
      params={page.carry}
      numberFormat={page.numberFormat}
      kind={category.type}
    />
  );
}

/** The categories of a group, with their totals in the period (§5.4). */
export function Children({ summary, page }: { summary: Summary; page: CategoryPage }) {
  const text = useTranslations("expenses");
  if (summary.children.length === 0) return null;
  return (
    <Card padded={false}>
      <h2 className="px-4 pt-3 text-lg font-semibold">{text("categories.detail.categories")}</h2>
      <ul className="flex flex-col">
        {summary.children.map((child) => (
          <li
            key={child.id}
            className="flex items-center gap-3 border-t border-border px-4 py-2 first:border-0"
          >
            <Link
              href={`/expenses/categories/${child.id}${withParams("", page.carry, {})}`}
              className="focus-ring inline-flex min-h-6 min-w-0 flex-1 items-center truncate rounded-xs hover:underline"
            >
              {child.name}
            </Link>
            <span className="tabular-nums">{money(child.amount, page)}</span>
            <span className="w-12 text-right text-sm text-muted tabular-nums">
              {formatPercent(child.share, page.numberFormat)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function Movements({ view, page }: { view: ApiState<View>; page: CategoryPage }) {
  const text = useTranslations("expenses");
  const { category } = page;
  return (
    <section aria-labelledby="category-movements" className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="category-movements" className="text-lg font-semibold">
          {text("categories.detail.movements")}
        </h2>
        <ButtonLink size="sm" href={withParams("/expenses", page.carry, { cat: category.id })}>
          {text("categories.detail.openInExpenses")}
        </ButtonLink>
      </div>
      <Loaded state={view}>
        {(data) => (
          <Card padded={false} className="overflow-clip">
            {data.rows.length === 0 ? (
              <p className="p-4 text-muted">{text("categories.detail.noMovements")}</p>
            ) : (
              <TransactionsTable
                groups={[
                  {
                    key: "category",
                    label: null,
                    count: data.rows.length,
                    total: "",
                    rows: data.rows.map((line) =>
                      lineViewOf(line, {
                        locale: page.prefs.locale,
                        timeZone: page.prefs.timeZone,
                        numberFormat: page.numberFormat,
                        colorOf: page.colorOf,
                        categories: page.options,
                      }),
                    ),
                  },
                ]}
                categories={page.options}
                labels={page.labels}
                params={page.carry}
                sort="date"
                direction="desc"
                path={page.here}
                sortable={false}
              />
            )}
          </Card>
        )}
      </Loaded>
    </section>
  );
}

/** The rules that give this category (categories-and-rules.md §5.4). */
export function Rules({ rules, page }: { rules: ApiState<RuleList>; page: CategoryPage }) {
  const text = useTranslations("expenses");
  const { category } = page;
  return (
    <Card className="flex min-w-0 flex-col gap-2">
      <h2 id="category-rules" className="text-lg font-semibold">
        {text("categories.detail.rules")}
      </h2>
      <Loaded state={rules}>
        {(data) =>
          data.rules.length === 0 ? (
            <p className="text-sm text-muted">{text("categories.detail.noRules")}</p>
          ) : (
            <ul aria-labelledby="category-rules" className="flex flex-col gap-1">
              {data.rules.map((rule) => (
                <li key={rule.id} className="flex items-center gap-2">
                  <Link
                    href={`/settings/finance/rules#rule-${rule.id}`}
                    className="focus-ring inline-flex min-h-6 min-w-0 items-center truncate rounded-xs hover:underline"
                  >
                    «{rule.name}» → {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
      {category.archivedAt === null && (
        <ButtonLink size="sm" className="self-start" href={`/settings/finance/rules?category=${category.id}`}>
          ＋ {text("categories.detail.newRule")}
        </ButtonLink>
      )}
    </Card>
  );
}
