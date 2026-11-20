"use client";

import type { Route } from "next";
import { useTranslations } from "next-intl";
import { TabLinks } from "@ledgerly/ui/tab-links";
import { type Params, withParams } from "@ledgerly/ui/url";

const TABS = [
  { id: "movements", href: "/expenses" },
  { id: "categories", href: "/expenses/categories" },
  { id: "review", href: "/expenses/review" },
] as const;

/**
 * The three pages of Expenses (categories-and-rules.md §5.1): the movements, the categories and
 * "To review", with the period and the accounts carried from one to the other.
 */
export function ExpensesTabs({ current, params }: { current: (typeof TABS)[number]["id"]; params: Params }) {
  const t = useTranslations("expenses.tabs");
  return (
    <TabLinks
      label={t("label")}
      tabs={TABS.map((tab) => ({
        href: withParams(tab.href, params, {}) as Route,
        label: t(tab.id),
        active: tab.id === current,
      }))}
    />
  );
}
