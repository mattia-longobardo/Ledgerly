import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getTranslations } from "next-intl/server";
import { budgets } from "@ledgerly/api-contract/budgets";
import { apiRead } from "@/platform/api-read";
import { BudgetScreen } from "./budget-screen";

/**
 * The name of the budget, or 404 when it has no limit this month: the title and the status of the
 * answer, which only the server can give before the page is drawn. It asks `/api/v1` (`apiRead`);
 * `cache` shares the read between the title and the page. Everything the page shows comes from the screen.
 */
const nameOf = cache(async (slug: string): Promise<string> => {
  const detail = await apiRead(budgets.getBudget, { params: { budget: slug } });
  if (!detail) notFound();
  return detail.budget.name ?? (await getTranslations("budgets"))("allCategories");
});

export async function generateMetadata({ params }: PageProps<"/budgets/[id]">): Promise<Metadata> {
  return { title: await nameOf((await params).id) };
}

/** One budget (spec §7.3): this month, the months before and its alerts, from `/api/v1`. */
export default async function BudgetPage({ params }: PageProps<"/budgets/[id]">) {
  const { id } = await params;
  await nameOf(id);
  return <BudgetScreen slug={id} />;
}
