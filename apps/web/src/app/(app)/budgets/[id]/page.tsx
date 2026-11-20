import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { budgetDetail, budgetName, parseBudgetSlug } from "@ledgerly/domain/budgets";
import { monthKey, today } from "@ledgerly/domain/shared/dates";
import { requireSession } from "@/platform/auth/session";
import { BudgetScreen } from "./budget-screen";

/**
 * The name of the budget, or 404 when it has no limit this month: the title and the status of the
 * answer, which only a server read can give before the page is drawn. M10: a necessary server read, as
 * on an account's page (decision A); everything the page shows comes from `/api/v1`.
 */
async function nameOf(slug: string): Promise<string> {
  const ctx = await requireSession();
  const scope = parseBudgetSlug(slug);
  const detail = scope && (await budgetDetail(ctx, scope, monthKey(today(ctx.timeZone))));
  if (!detail) notFound();
  return budgetName(detail.row) ?? (await getTranslations("budgets"))("allCategories");
}

export async function generateMetadata({ params }: PageProps<"/budgets/[id]">): Promise<Metadata> {
  return { title: await nameOf((await params).id) };
}

/** One budget (spec §7.3): this month, the months before and its alerts, from `/api/v1`. */
export default async function BudgetPage({ params }: PageProps<"/budgets/[id]">) {
  const { id } = await params;
  await nameOf(id);
  return <BudgetScreen slug={id} />;
}
