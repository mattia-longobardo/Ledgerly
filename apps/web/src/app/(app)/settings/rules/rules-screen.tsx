"use client";

// Settings › Rules, read from `/api/v1` (rewrite plan R3; categories-and-rules.md §4). `?from=<movement>`
// opens the editor filled from a movement (§4.7), `?category=<id>` with the category already chosen (§5.4).
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { accounts as accountRoutes } from "@ledgerly/api-contract/accounts";
import {
  categories as categoryRoutes,
  labels as labelRoutes,
  profile,
} from "@ledgerly/api-contract/settings";
import { rules } from "@ledgerly/api-contract/transactions";
import type { RouteOutput } from "@ledgerly/api-client";
import { numberStyle } from "@ledgerly/format/format";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { categoryColors, withMacroTitles } from "@/modules/transactions/client";
import { type RuleDraft, RulesBoard } from "./rules-board";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Category = RouteOutput<typeof categoryRoutes.listCategories>["categories"][number];
type Translate = ReturnType<typeof useTranslations<"expenses">>;

interface Answers {
  prefs: RouteOutput<typeof profile.getPreferences>;
  rules: RouteOutput<typeof rules.listRules>["rules"];
  categories: Category[];
  labels: RouteOutput<typeof labelRoutes.listLabels>["labels"];
  accounts: RouteOutput<typeof accountRoutes.listAccounts>["accounts"];
  draft: RouteOutput<typeof rules.getRuleDraft>["draft"];
  fromId: string | undefined;
}

export function RulesScreen() {
  const search = useSearchParams();
  const uuid = (key: string) => {
    const value = search.get(key);
    return value !== null && UUID.test(value) ? value : undefined;
  };
  const fromId = uuid("from");
  const prefs = useApi(profile.getPreferences, {});
  const ruleList = useApi(rules.listRules, { query: {} });
  const categoryList = useApi(categoryRoutes.listCategories, { query: { archived: "true" } });
  const labelList = useApi(labelRoutes.listLabels, {});
  const accountList = useApi(accountRoutes.listAccounts, {});
  // The draft does not hold the list back: the editor opens when it arrives.
  const draft = useApi(rules.getRuleDraft, { query: { from: fromId, category: uuid("category") } });
  return (
    <Loaded state={prefs}>
      {(prefsData) => (
        <Loaded state={ruleList}>
          {(ruleData) => (
            <Loaded state={categoryList}>
              {(categoryData) => (
                <Loaded state={labelList}>
                  {(labelData) => (
                    <Loaded state={accountList}>
                      {(accountData) => (
                        <RulesData
                          prefs={prefsData}
                          rules={ruleData.rules}
                          categories={categoryData.categories}
                          labels={labelData.labels}
                          accounts={accountData.accounts}
                          draft={draft.data?.draft ?? null}
                          fromId={fromId}
                        />
                      )}
                    </Loaded>
                  )}
                </Loaded>
              )}
            </Loaded>
          )}
        </Loaded>
      )}
    </Loaded>
  );
}

/** The categories a rule can give: the open ones, in their macro sections. */
function pickerOptions(all: Category[], text: Translate) {
  const colorOf = categoryColors(all);
  return withMacroTitles(
    all
      .filter((category) => category.archivedAt === null)
      .map((category) => ({
        id: category.id,
        name: category.name,
        color: colorOf.get(category.id) ?? "",
        depth: category.depth,
        type: category.type,
      })),
    {
      income: text("categories.macro.income"),
      expense: text("categories.macro.expense"),
      transfer: text("categories.macro.transfer"),
    },
  );
}

/** "Section › group › category" for the line under a rule (§4.2). */
function pathsOf(all: Category[], text: Translate): Map<string, string> {
  return new Map(
    all.map((category) => {
      const group = all.find((one) => one.id === category.parentId);
      return [
        category.id,
        [text(`categories.macro.${category.type}`), group?.name, category.name].filter(Boolean).join(" › "),
      ];
    }),
  );
}

/**
 * The editor filled from a movement (§4.7), or with a category chosen (§5.4): a category that cannot
 * be chosen is left out, and alone it gives no draft.
 */
function draftOf(
  found: Answers["draft"],
  fromId: string | undefined,
  options: { id: string }[],
): RuleDraft | null {
  const isOpen = (id: string | null) => id !== null && options.some((category) => category.id === id);
  if (found === null || (fromId === undefined && !isOpen(found.categoryId))) return null;
  return { ...found, categoryId: isOpen(found.categoryId) ? found.categoryId : null };
}

/** The board's props, derived once per answer: the board keeps its state until an answer changes. */
function RulesData(answers: Answers) {
  const text = useTranslations("expenses");
  const {
    prefs,
    rules: list,
    categories: all,
    labels: tags,
    accounts: owned,
    draft: found,
    fromId,
  } = answers;
  const options = useMemo(() => pickerOptions(all, text), [all, text]);
  const ruleViews = useMemo(() => {
    const pathOf = pathsOf(all, text);
    return list.map((rule) => ({ ...rule, path: pathOf.get(rule.categoryId) ?? "" }));
  }, [list, all, text]);
  const draft = useMemo(() => draftOf(found, fromId, options), [found, fromId, options]);
  const names = useMemo(
    () => ({
      labels: tags.map((label) => ({ id: label.id, name: label.name })),
      accounts: owned.map((account) => ({ id: account.id, name: account.name })),
      currencies: [...new Set(["EUR", ...owned.map((account) => account.currency)])].sort(),
    }),
    [tags, owned],
  );
  const numberFormat = useMemo(() => numberStyle(prefs), [prefs]);
  return (
    <RulesBoard
      rules={ruleViews}
      categories={options}
      labels={names.labels}
      accounts={names.accounts}
      currencies={names.currencies}
      numberFormat={numberFormat}
      draft={draft}
    />
  );
}
