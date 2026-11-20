import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BudgetsScreen } from "./budgets-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("budgets"))("title") };
}

/** Budgets reads everything it shows from `/api/v1` (rewrite plan R3). */
export default function BudgetsPage() {
  return <BudgetsScreen />;
}
