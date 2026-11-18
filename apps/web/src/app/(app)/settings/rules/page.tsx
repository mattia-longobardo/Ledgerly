import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { listAccounts } from "@ledgerly/domain/accounts";
import { memoryKey } from "@ledgerly/domain/transactions";
import type { RuleCondition } from "@ledgerly/domain/transactions";
import { listRules } from "@ledgerly/domain/transactions";
import { getTransaction } from "@ledgerly/domain/transactions";
import { listCategories, listLabels } from "@ledgerly/domain/transactions";
import { categoryColors, withMacroTitles } from "@/modules/transactions/ui/display";
import { requireSession } from "@/platform/auth/session";
import { type RuleDraft, RulesBoard } from "./rules-board";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.rules")} · ${t("title")}` };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Settings › Rules (categories-and-rules.md §4). `?from=<movement>` opens the editor filled from a
 * movement (§4.7), `?category=<id>` with the category already chosen (§5.4).
 */
export default async function SettingsRulesPage({ searchParams }: PageProps<"/settings/rules">) {
  const ctx = await requireSession();
  const raw = await searchParams;
  const one = (key: string) => {
    const value = raw[key];
    return typeof value === "string" && UUID.test(value) ? value : null;
  };
  const [t, rules, categories, labels, accounts] = await Promise.all([
    getTranslations("expenses"),
    listRules(ctx),
    listCategories(ctx, { includeArchived: true }),
    listLabels(ctx),
    listAccounts(ctx),
  ]);
  const colorOf = categoryColors(categories);
  const open = categories.filter((category) => category.archivedAt === null);
  const pickerOptions = withMacroTitles(
    open.map((category) => ({
      id: category.id,
      name: category.name,
      color: colorOf.get(category.id) as string,
      depth: category.depth,
      type: category.type,
    })),
    {
      income: t("categories.macro.income"),
      expense: t("categories.macro.expense"),
      transfer: t("categories.macro.transfer"),
    },
  );
  /** "Section › group › category" for the line under a rule (§4.2). */
  const pathOf = new Map(
    categories.map((category) => {
      const group = categories.find((one) => one.id === category.parentId);
      return [
        category.id,
        [t(`categories.macro.${category.type}`), group?.name, category.name].filter(Boolean).join(" › "),
      ];
    }),
  );

  // The editor filled from a movement (§4.7), or with a category chosen (§5.4).
  let draft: RuleDraft | null = null;
  const fromId = one("from");
  const categoryId = one("category");
  if (fromId !== null) {
    const movement = await getTransaction(ctx, fromId);
    if (movement !== null) {
      const text = memoryKey({ ...movement, counterparty: movement.counterpartyName });
      const conditions: RuleCondition[] = [];
      if (movement.counterpartyName) {
        conditions.push({
          field: "counterparty",
          op: "equals",
          value: movement.counterpartyName.slice(0, 100),
        });
      } else if (text !== "") {
        conditions.push({ field: "text", op: "contains", value: text.slice(0, 100) });
      }
      conditions.push({ field: "account", accountIds: [movement.accountId] });
      const chosen = categoryId ?? movement.categoryId;
      draft = {
        name: (movement.counterpartyName ?? movement.payee ?? text).slice(0, 80),
        conditions,
        categoryId: chosen !== null && open.some((category) => category.id === chosen) ? chosen : null,
      };
    }
  } else if (categoryId !== null && open.some((category) => category.id === categoryId)) {
    draft = { name: "", conditions: [{ field: "text", op: "contains", value: "" }], categoryId };
  }

  const currencies = [...new Set(["EUR", ...accounts.map((account) => account.currency)])].sort();
  return (
    <RulesBoard
      rules={rules.map((rule) => ({ ...rule, path: pathOf.get(rule.categoryId) ?? "" }))}
      categories={pickerOptions}
      labels={labels.map((label) => ({ id: label.id, name: label.name }))}
      accounts={accounts.map((account) => ({ id: account.id, name: account.name }))}
      currencies={currencies}
      numberFormat={ctx.numberFormat}
      draft={draft}
    />
  );
}
