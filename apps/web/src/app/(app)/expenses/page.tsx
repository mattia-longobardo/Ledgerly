import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ExpensesScreen } from "./expenses-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("expenses"))("title") };
}

/** Expenses reads everything it shows from `/api/v1`. */
export default function ExpensesPage() {
  return <ExpensesScreen />;
}
