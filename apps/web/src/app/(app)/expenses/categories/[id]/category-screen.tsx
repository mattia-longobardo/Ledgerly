"use client";

// The page of one category or group (categories-and-rules.md §5.4), read from `/api/v1` (rewrite plan
// R3): what it spent, received or moved in the period against the period before, its movements, the
// chart of Expenses on it alone and its budget. Every figure is a field of a route; here it is formatted.
import { Compass } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  categories as categoryRoutes,
  labels as labelRoutes,
  profile,
} from "@ledgerly/api-contract/settings";
import { movements, rules as ruleRoutes, spending } from "@ledgerly/api-contract/transactions";
import { today } from "@ledgerly/format/dates";
import { numberStyle } from "@ledgerly/format/format";
import { ButtonLink } from "@ledgerly/ui/button";
import { type ApiState, useApi, useLatest } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { PeriodBar } from "@ledgerly/ui/period-bar";
import { Page } from "@ledgerly/ui/shell/page";
import { EmptyState } from "@ledgerly/ui/states";
import { withParams } from "@ledgerly/ui/url";
import { categoryColor, categoryColors, withMacroTitles } from "@/modules/transactions";
import {
  CATEGORY_CALLS,
  CategoryActions,
  type ExpensesQuery,
  parseExpensesQuery,
} from "@/modules/transactions/client";
import {
  type Category,
  CategoryHeading,
  type CategoryPage,
  Children,
  Movements,
  Rules,
  Spending,
  Tiles,
} from "./category-blocks";

/** The rows of the table on this page (categories-and-rules.md §5.4): the rest is in Expenses. */
const ROWS = 50;

export function CategoryScreen({ id }: { id: string }) {
  const text = useTranslations("expenses");
  const prefs = useApi(profile.getPreferences, {});
  // Archived ones too: an archived category has its page, with «Restore».
  const categoryList = useApi(categoryRoutes.listCategories, { query: { archived: "true" } });
  const labelList = useApi(labelRoutes.listLabels, {});
  if (prefs.data === undefined || categoryList.data === undefined || labelList.data === undefined) {
    const state = [prefs, categoryList, labelList].find((one) => one.data === undefined) ?? prefs;
    return <Reading title={text("categories.title")} state={state} />;
  }
  const all = categoryList.data.categories;
  const category = all.find((one) => one.id === id);
  if (!category) return <Missing title={text("categories.title")} />;
  return <CategoryView category={category} all={all} prefs={prefs.data} labels={labelList.data.labels} />;
}

/** A read that has no answer yet, inside the page's frame: the screen has its `<main>` from the start. */
function Reading({ title, state }: { title: string; state: ApiState<unknown> }) {
  return (
    <Page title={title}>
      <Loaded state={state}>{() => null}</Loaded>
    </Page>
  );
}

/** What the server's «not found» page said, for a category that is not there (any more). */
function Missing({ title }: { title: string }) {
  const text = useTranslations("errors.notFound");
  return (
    <Page title={title}>
      <EmptyState
        icon={<Compass aria-hidden className="size-[18px]" />}
        title={text("title")}
        description={text("description")}
        actions={
          <ButtonLink href="/" variant="primary">
            {text("cta")}
          </ButtonLink>
        }
      />
    </Page>
  );
}

function CategoryView({
  category,
  all,
  prefs,
  labels,
}: {
  category: Category;
  all: readonly Category[];
  prefs: CategoryPage["prefs"];
  labels: CategoryPage["labels"];
}) {
  const text = useTranslations("expenses");
  const query = parseExpensesQuery(Object.fromEntries(useSearchParams().entries()), today(prefs.timeZone));
  const period = { preset: query.params.preset, from: query.params.from, to: query.params.to };
  const carry = { ...period, off: query.params.off, acc: query.params.acc };
  const { summary, series, view, ruleList } = useCategoryReads(category, query);
  const colorOf = categoryColors(all);
  const options = pickerOptions(all, colorOf, {
    income: text("categories.macro.income"),
    expense: text("categories.macro.expense"),
    transfer: text("categories.macro.transfer"),
  });
  const page: CategoryPage = {
    category,
    group: category.parentId === null ? null : (all.find((one) => one.id === category.parentId) ?? null),
    query,
    here: `/expenses/categories/${category.id}`,
    carry,
    prefs,
    numberFormat: numberStyle(prefs),
    colorOf,
    options,
    labels,
    listHref: (macro) =>
      withParams("/expenses/categories", carry, { macro: macro === "expense" ? undefined : macro }),
  };

  return (
    <CategoryActions commands={CATEGORY_CALLS} categories={options}>
      <Page
        title={category.name}
        parent={{ href: page.listHref(category.type), label: text("categories.title") }}
      >
        <CategoryHeading page={page} source={summary.data?.source ?? null} />
        <PeriodBar
          period={{ preset: query.preset, offset: query.offset, range: query.range, stepperParams: period }}
          path={page.here}
          carry={{ acc: carry.acc }}
          locale={prefs.locale}
        />
        <Loaded state={summary}>{(data) => <Tiles summary={data} page={page} />}</Loaded>
        <Loaded state={series}>{(data) => <Spending series={data} page={page} />}</Loaded>
        {summary.data && <Children summary={summary.data} page={page} />}
        <div className="grid grid-cols-1 items-start gap-4 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Movements view={view} page={page} />
          <Rules rules={ruleList} page={page} />
        </div>
      </Page>
    </CategoryActions>
  );
}

/** The reads of the page; those that follow the address keep the previous answer while they read. */
function useCategoryReads(category: Category, query: ExpensesQuery) {
  const scope = {
    from: query.range.from,
    to: query.range.to,
    accounts: query.accountSelection.length > 0 ? query.accountSelection.join(",") : undefined,
  };
  const summary = useLatest(
    useApi(categoryRoutes.getCategorySummary, { params: { id: category.id }, query: scope }),
  );
  // The chart draws the category's own macro: what came in for Income, what went out for Transfers.
  const series = useLatest(
    useApi(spending.getSpendingSeries, {
      query: { ...scope, category: category.id, type: category.type, grain: query.grain },
    }),
  );
  const view = useLatest(
    useApi(movements.getTransactionsView, { query: { ...scope, category: category.id, limit: ROWS } }),
  );
  const ruleList = useApi(ruleRoutes.listRules, { query: { category: category.id } });

  return { summary, series, view, ruleList };
}

/** The active categories as every picker offers them, under the title of their macro (§2.4). */
function pickerOptions(
  all: readonly Category[],
  colorOf: ReadonlyMap<string, string>,
  titles: Record<Category["type"], string>,
) {
  return withMacroTitles(
    all
      .filter((one) => one.archivedAt === null)
      .map((one) => ({
        id: one.id,
        name: one.name,
        color: colorOf.get(one.id) ?? categoryColor(one.color, 0),
        depth: one.depth,
        type: one.type,
      })),
    titles,
  );
}
