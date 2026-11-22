"use client";

// Expenses › Categories (categories-and-rules.md §5), read from `/api/v1` (rewrite plan R3): the three
// macros, their groups and categories with the totals of a period (`GET /categories/board`), and the
// menu that changes the structure. The period and the accounts are the ones of Expenses, read from the
// same address, so moving between the two pages keeps them. The screen formats; it sums nothing.
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { accounts as accountRoutes } from "@ledgerly/api-contract/accounts";
import { categoryBoard, profile } from "@ledgerly/api-contract/settings";
import { movements } from "@ledgerly/api-contract/transactions";
import type { RouteOutput } from "@ledgerly/api-client";
import { DEFAULT_GROUPS } from "@ledgerly/domain/transactions/client";
import { today } from "@ledgerly/format/dates";
import { numberStyle } from "@ledgerly/format/format";
import { useApi, useLatest } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { PeriodBar } from "@ledgerly/ui/period-bar";
import { Page } from "@ledgerly/ui/shell/page";
import { EmptyState } from "@ledgerly/ui/states";
import { categoryColor } from "@/modules/transactions";
import { AccountsMenu, type ExpensesQuery, parseExpensesQuery } from "@/modules/transactions/client";
import { DefaultGroupsButton } from "../../settings/finance/default-groups";
import { ExpensesTabs } from "../tabs";
import { CategoriesBoard } from "./board";
import { type Macro, MACROS } from "./board-model";
import { boardOf } from "./board-view";

const HERE = "/expenses/categories";

type Prefs = RouteOutput<typeof profile.getPreferences>;
type Facets = RouteOutput<typeof movements.getTransactionFacets>;
type Accounts = RouteOutput<typeof accountRoutes.listAccounts>["accounts"];

/** The accounts of the menu: those with movements in the period, and those chosen, by name. */
function accountOptions(accounts: Accounts, facets: Facets, selection: readonly string[]) {
  const counted = new Map(facets.accounts.map((facet) => [facet.accountId, facet.count]));
  return accounts
    .map((account) => ({ id: account.id, name: account.name, count: counted.get(account.id) ?? 0 }))
    .filter((account) => account.count > 0 || selection.includes(account.id))
    .sort((first, second) => first.name.localeCompare(second.name));
}

/** With no category at all: the default groups, in the person's language. */
function NoCategories({ prefs }: { prefs: Prefs }) {
  const text = useTranslations("expenses");
  return (
    <EmptyState
      title={text("categories.empty.title")}
      description={text("categories.empty.description")}
      actions={
        <DefaultGroupsButton
          groups={DEFAULT_GROUPS.map((group, index) => ({
            key: group.key,
            name: group[prefs.locale],
            examples: group.examples[prefs.locale],
            color: categoryColor(null, index),
          }))}
        />
      }
    />
  );
}

/** The period and the accounts of the page, as Expenses writes them, and the macro on screen. */
function usePageQuery(prefs: Prefs) {
  const raw = Object.fromEntries(useSearchParams().entries());
  const query = parseExpensesQuery(raw, today(prefs.timeZone));
  const period = { preset: query.params.preset, from: query.params.from, to: query.params.to };
  const carry = { ...period, off: query.params.off, acc: query.params.acc };
  const macro: Macro = MACROS.find((key) => key === raw.macro?.trim()) ?? "expense";
  return { query, period, carry, macro };
}

function Filters({ query, carry, macro, prefs }: ReturnType<typeof usePageQuery> & { prefs: Prefs }) {
  const { from, to } = query.range;
  const facets = useLatest(useApi(movements.getTransactionFacets, { query: { from, to } }));
  // The menu lists archived accounts too, as before.
  const accountList = useApi(accountRoutes.listAccounts, { query: { archived: "true" } });
  const kept = { macro: macro === "expense" ? undefined : macro };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PeriodBar
        period={{
          preset: query.preset,
          offset: query.offset,
          range: query.range,
          stepperParams: { preset: carry.preset, from: carry.from, to: carry.to },
        }}
        path={HERE}
        carry={{ acc: carry.acc, ...kept }}
        locale={prefs.locale}
      />
      {facets.data && accountList.data && (
        <AccountsMenu
          accounts={accountOptions(accountList.data.accounts, facets.data, query.accountSelection)}
          selection={query.accountSelection}
          path={HERE}
          carry={{ ...carry, ...kept }}
        />
      )}
    </div>
  );
}

function Board({ page, prefs }: { page: ReturnType<typeof usePageQuery>; prefs: Prefs }) {
  const text = useTranslations("expenses");
  const { query, carry, macro } = page;
  const scope = scopeOf(query);
  const read = useLatest(useApi(categoryBoard.getCategoriesBoard, { query: scope }));
  return (
    <Loaded state={read}>
      {(board) => {
        const macros = boardOf(board, {
          numberFormat: numberStyle(prefs),
          carry,
          range: query.range,
          accounts: query.accountSelection,
          sourceText: (source) =>
            text("categories.source", { provider: source.name, names: source.names.join(", ") }),
        });
        const none = !macros.some((one) =>
          one.groups.some((group) => !group.archived || group.children.some((child) => !child.archived)),
        );
        return (
          <CategoriesBoard
            macros={macros}
            initialMacro={macro}
            empty={none && <NoCategories prefs={prefs} />}
          />
        );
      }}
    </Loaded>
  );
}

const scopeOf = (query: ExpensesQuery) => ({
  from: query.range.from,
  to: query.range.to,
  accounts: query.accountSelection.length > 0 ? query.accountSelection.join(",") : undefined,
});

function BoardPage({ prefs }: { prefs: Prefs }) {
  const text = useTranslations("expenses");
  const page = usePageQuery(prefs);
  const title = text("categories.title");
  return (
    <Page title={title} parent={{ href: "/expenses", label: text("title") }}>
      <h1 className="text-title font-semibold tracking-title">{title}</h1>
      <ExpensesTabs current="categories" params={page.carry} />
      <Filters {...page} prefs={prefs} />
      <Board page={page} prefs={prefs} />
    </Page>
  );
}

/** Expenses › Categories: the period of the address, read from `/api/v1`. */
export function CategoriesBoardScreen() {
  const preferences = useApi(profile.getPreferences, {});
  return <Loaded state={preferences}>{(prefs) => <BoardPage prefs={prefs} />}</Loaded>;
}
