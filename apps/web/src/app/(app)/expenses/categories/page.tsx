import type { Metadata, Route } from "next";
import { getTranslations } from "next-intl/server";
import { budgetsView } from "@ledgerly/domain/budgets";
import { periodEnd } from "@/modules/accounts/ui/period";
import { PeriodBar } from "@/modules/accounts/ui/period-bar";
import { createDefaultGroupsAction } from "@/modules/transactions/categorize/actions";
import { DEFAULT_GROUPS } from "@ledgerly/domain/transactions";
import { categoryMacroTotals, facetCounts } from "@ledgerly/domain/transactions";
import { colorOfCategory, listCategoriesWithUsage } from "@ledgerly/domain/transactions";
import { categoryColor } from "@/modules/transactions/ui/display";
import { AccountsMenu } from "@/modules/transactions/ui/filter-bar";
import { parseExpensesQuery } from "@/modules/transactions/ui/filters";
import { MACROS, type Macro, macroViews } from "@/modules/transactions/ui/macros";
import { listAccounts } from "@ledgerly/domain/accounts";
import { requireSession } from "@/platform/auth/session";
import { monthKey, today } from "@ledgerly/domain/shared/dates";
import { formatMoney, formatPercent } from "@ledgerly/domain/platform/format";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";
import { withParams } from "@/ui/url";
import { DefaultGroupsButton } from "../../settings/categories/default-groups";
import { sourceNotes } from "../../settings/categories/source";
import { sourceHref } from "../../settings/integrations/connection-view";
import { ExpensesTabs } from "../tabs";
import { type BoardLine, type BoardMacro, CategoriesBoard } from "./board";

const HERE = "/expenses/categories";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("expenses.categories"))("title") };
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() ?? "";

/**
 * Expenses › Categories (categories-and-rules.md §5): the three macros, their groups and
 * categories with the totals of a period, and the menu that changes the structure. The period and
 * the accounts are the ones of Expenses, read from the same address, so moving between the two
 * pages keeps them. Everything is summed here, on the server; the board draws and acts.
 */
export default async function CategoriesPage({ searchParams }: PageProps<"/expenses/categories">) {
  const ctx = await requireSession();
  const t = await getTranslations("expenses");
  const raw = await searchParams;
  const todayOn = today(ctx.timeZone);
  const query = parseExpensesQuery(raw, todayOn);
  const filters = { from: query.range.from, to: query.range.to, accountIds: query.accountSelection };

  const [categories, totals, accounts, facets, budgets, notes] = await Promise.all([
    listCategoriesWithUsage(ctx, { includeArchived: true }),
    categoryMacroTotals(ctx, filters),
    listAccounts(ctx, { includeArchived: true }),
    facetCounts(ctx, { from: filters.from, to: filters.to }),
    budgetsView(ctx, monthKey(periodEnd(query.range, todayOn))),
    sourceNotes(ctx),
  ]);

  const money = (cents: bigint) => formatMoney(cents, ctx.numberFormat);
  const byId = new Map(categories.map(({ category }) => [category.id, category]));
  const usage = new Map(categories.map((row) => [row.category.id, row.usage]));
  const budgetOf = new Map(
    budgets.rows
      .filter((row) => row.accountId === null && row.categoryId !== null)
      .map((row) => [row.categoryId as string, row]),
  );
  // What every link of the page keeps: the period and the accounts, as Expenses writes them.
  const period = { preset: query.params.preset, from: query.params.from, to: query.params.to };
  const carry = { ...period, off: query.params.off, acc: query.params.acc };
  const views = macroViews(
    categories.map(({ category }) => ({
      id: category.id,
      name: category.name,
      parentId: category.parentId,
      type: category.type,
      archived: category.archivedAt !== null,
    })),
    totals,
  );

  const lineOf = (line: (typeof views)[number]["groups"][number]["children"][number]): BoardLine => {
    const category = byId.get(line.category.id);
    const budget = budgetOf.get(line.category.id);
    const note = notes.get(line.category.id);
    const href = note ? sourceHref(note.provider) : null;
    return {
      id: line.category.id,
      name: line.category.name,
      parentId: line.category.parentId,
      type: line.category.type,
      color: category ? colorOfCategory(category, byId) : categoryColor(null, 0),
      chosenColor: category?.color ?? null,
      archived: line.category.archived,
      canMerge: category?.providerName === null,
      usage: usage.get(line.category.id) ?? 0,
      count: line.count,
      total: money(line.totalCents),
      zero: line.count === 0,
      share: line.share,
      shareText: formatPercent(line.share / 100, ctx.numberFormat),
      inTotal: money(line.inCents),
      outTotal: money(-line.outCents),
      href: `${HERE}/${line.category.id}${withParams("", carry, {})}` as Route,
      budget: budget ? { limit: money(budget.limitCents), status: budget.status } : null,
      source:
        note && note.names.length > 0
          ? {
              text: t("categories.source", { provider: note.source, names: note.names.join(", ") }),
              href: href as Route | null,
            }
          : null,
    };
  };

  const expensesHref = (changes: Record<string, string | undefined>) =>
    withParams("/expenses", carry, changes) as Route;
  const board: BoardMacro[] = views.map((view) => ({
    macro: view.macro,
    total: money(view.totalCents),
    count: view.count,
    inTotal: money(view.inCents),
    outTotal: money(-view.outCents),
    groups: view.groups.map((group) => ({
      ...lineOf(group),
      only: group.only
        ? {
            total: money(group.only.totalCents),
            count: group.only.count,
            href: expensesHref({ cat: group.category.id }),
          }
        : null,
      children: group.children.map(lineOf),
    })),
    rest:
      view.rest === null
        ? null
        : {
            count: view.rest.count,
            total: money(view.rest.totalCents),
            inTotal: money(view.rest.inCents),
            outTotal: money(-view.rest.outCents),
            href:
              view.macro === "transfer"
                ? expensesHref({ type: "transfer" })
                : (withParams(
                    "/expenses/review",
                    {},
                    {
                      from: query.range.from,
                      to: query.range.to,
                      acc: query.accountSelection.length > 0 ? query.accountSelection.join(",") : undefined,
                    },
                  ) as Route),
          },
  }));

  const wanted = one(raw.macro);
  const macro: Macro = MACROS.find((key) => key === wanted) ?? "expense";
  const accountCount = new Map(facets.accounts.map((facet) => [facet.accountId, facet.count]));
  const accountOptions = accounts
    .map((account) => ({ id: account.id, name: account.name, count: accountCount.get(account.id) ?? 0 }))
    .filter((account) => account.count > 0 || query.accountSelection.includes(account.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const title = t("categories.title");
  const none = !categories.some(({ category }) => category.archivedAt === null);

  return (
    <Page title={title} parent={{ href: "/expenses" as Route, label: t("title") }}>
      <h1 className="text-title font-semibold tracking-title">{title}</h1>
      <ExpensesTabs current="categories" params={carry} />
      <div className="flex flex-wrap items-center gap-2">
        <PeriodBar
          period={{
            preset: query.preset,
            offset: query.offset,
            range: query.range,
            stepperParams: period,
          }}
          path={HERE}
          carry={{ acc: carry.acc, macro: macro === "expense" ? undefined : macro }}
          locale={ctx.locale}
        />
        <AccountsMenu
          accounts={accountOptions}
          selection={query.accountSelection}
          path={HERE}
          carry={{ ...carry, macro: macro === "expense" ? undefined : macro }}
        />
      </div>
      <CategoriesBoard
        macros={board}
        initialMacro={macro}
        empty={
          none && (
            <EmptyState
              title={t("categories.empty.title")}
              description={t("categories.empty.description")}
              actions={
                <DefaultGroupsButton
                  groups={DEFAULT_GROUPS.map((group, index) => ({
                    key: group.key,
                    name: group[ctx.locale],
                    examples: group.examples[ctx.locale],
                    color: categoryColor(null, index),
                  }))}
                  create={createDefaultGroupsAction}
                />
              }
            />
          )
        }
      />
    </Page>
  );
}
