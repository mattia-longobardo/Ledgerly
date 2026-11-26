"use client";

// Expenses (spec §7.2), read from `/api/v1` (rewrite plan R3): the rows, the totals, the facets and the
// cards are fields of `GET /transactions/view` and of the spending reads. Every filter lives in the
// address; the screen reads it, asks the routes, colours and formats. Only what a browser must own —
// the selection, the open editor, the keyboard cursor — is state, in `TransactionsTable`.
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  categories as categoryRoutes,
  labels as labelRoutes,
  profile,
} from "@ledgerly/api-contract/settings";
import { accounts as accountRoutes } from "@ledgerly/api-contract/accounts";
import { movements, spending } from "@ledgerly/api-contract/transactions";
import type { RouteOutput } from "@ledgerly/api-client";
import { today } from "@ledgerly/format/dates";
import { numberStyle } from "@ledgerly/format/format";
import { ButtonLink } from "@ledgerly/ui/button";
import { type ApiState, useApi, useLatest } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { Page } from "@ledgerly/ui/shell/page";
import { EmptyState } from "@ledgerly/ui/states";
import { categoryColor, categoryColors, withMacroTitles } from "@/modules/transactions";
import {
  AddMovementButton,
  CATEGORY_CALLS,
  CategoryActions,
  filtersOf,
  MANUAL_CALLS,
  ManualMovement,
  parseExpensesQuery,
  routeFiltersOf,
} from "@/modules/transactions/client";
import { Movements, type Reads, type Screen } from "./expenses-blocks";

type Preferences = RouteOutput<typeof profile.getPreferences>;
type Category = RouteOutput<typeof categoryRoutes.listCategories>["categories"][number];
type Label = RouteOutput<typeof labelRoutes.listLabels>["labels"][number];

export function ExpensesScreen() {
  const text = useTranslations("expenses");
  const prefs = useApi(profile.getPreferences, {});
  const categoryList = useApi(categoryRoutes.listCategories, { query: {} });
  const labelList = useApi(labelRoutes.listLabels, {});
  if (prefs.data === undefined || categoryList.data === undefined || labelList.data === undefined) {
    return (
      <Reading
        title={text("title")}
        state={[prefs, categoryList, labelList].find((one) => one.data === undefined) ?? prefs}
      />
    );
  }
  return (
    <Expenses prefs={prefs.data} categories={categoryList.data.categories} labels={labelList.data.labels} />
  );
}

/** A read that has no answer yet, inside the page's frame: the screen has its `<main>` from the start. */
function Reading({ title, state }: { title: string; state: ApiState<unknown> }) {
  return (
    <Page title={title}>
      <Loaded state={state}>{() => null}</Loaded>
    </Page>
  );
}

function Expenses({
  prefs,
  categories,
  labels,
}: {
  prefs: Preferences;
  categories: readonly Category[];
  labels: readonly Label[];
}) {
  const text = useTranslations("expenses");
  const raw = Object.fromEntries(useSearchParams().entries());
  const query = parseExpensesQuery(raw, today(prefs.timeZone));
  const filters = routeFiltersOf(filtersOf(query));
  const { reads, pending } = useReads(filters, query);

  /**
   * One colour per category, decided once: the filter menu, the row chips and the cards all read
   * this map, so a category without a colour of its own looks the same everywhere — and a
   * sub-category always has its group's colour (spec §7.2).
   */
  const colorOf = categoryColors(categories);
  const options = optionsOf(categories, colorOf);
  const screen: Screen = {
    query,
    filters,
    locale: prefs.locale,
    timeZone: prefs.timeZone,
    numberFormat: numberStyle(prefs),
    colorOf,
    categories,
    options,
    // The pickers list the categories under the title of their macro (categories-and-rules.md §2.4).
    pickerOptions: withMacroTitles(options, {
      income: text("categories.macro.income"),
      expense: text("categories.macro.expense"),
    }),
    labels,
  };

  return (
    <ManualMovement
      commands={MANUAL_CALLS}
      categories={options}
      labels={labels}
      shown={{
        from: query.range.from,
        to: query.range.to,
        accountIds: query.accountSelection,
        narrowed: query.categorySelection.length > 0 || query.typeSelection.length > 0 || query.search !== "",
      }}
      // The palette's command arrives as an address.
      openOnMount={raw.add === "1"}
    >
      {reads === null ? (
        <Reading title={text("title")} state={pending} />
      ) : reads.view.hasAny ? (
        <CategoryActions commands={CATEGORY_CALLS} categories={screen.pickerOptions}>
          <Movements reads={reads} screen={screen} />
        </CategoryActions>
      ) : (
        <NoMovements />
      )}
    </ManualMovement>
  );
}

/**
 * The four reads of the screen. It is drawn once every read has an answer, as the server's page was:
 * no block moves the others while it arrives, and a new filter keeps the previous answers meanwhile.
 */
function useReads(
  filters: ReturnType<typeof routeFiltersOf>,
  query: ReturnType<typeof parseExpensesQuery>,
): { reads: Reads | null; pending: ApiState<unknown> } {
  const view = useLatest(
    useApi(movements.getTransactionsView, {
      query: { ...filters, sort: query.sort, direction: query.direction },
    }),
  );
  // The spending chart is about spending whatever type the list shows: the type filter is set aside.
  const series = useLatest(
    useApi(spending.getSpendingSeries, { query: { ...filters, types: undefined, grain: query.grain } }),
  );
  const breakdown = useLatest(useApi(spending.getSpendingBreakdown, { query: filters }));
  // The account menu lists archived accounts too, as before.
  const accountList = useApi(accountRoutes.listAccounts, { query: { archived: "true" } });
  if (view.data && series.data && breakdown.data && accountList.data) {
    const reads = {
      view: view.data,
      series: series.data,
      breakdown: breakdown.data,
      accounts: accountList.data.accounts,
    };
    return { reads, pending: view };
  }
  const pending = [view, series, breakdown, accountList].find((one) => one.data === undefined) ?? view;
  return { reads: null, pending };
}

/** The categories as every picker offers them, in tree order, each in the screen's colour. */
function optionsOf(categories: readonly Category[], colorOf: ReadonlyMap<string, string>) {
  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    color: colorOf.get(category.id) ?? categoryColor(category.color, 0),
    depth: category.depth,
    type: category.type,
  }));
}

function NoMovements() {
  const text = useTranslations("expenses");
  return (
    <Page title={text("title")}>
      <h1 className="text-title font-semibold tracking-title max-md:sr-only">{text("title")}</h1>
      <EmptyState
        title={text("unsynced.title")}
        description={text("unsynced.description")}
        actions={
          <>
            <AddMovementButton />
            <ButtonLink href="/settings/plugins">{text("unsynced.action")}</ButtonLink>
          </>
        }
      />
    </Page>
  );
}
