import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { categoryOptions } from "@ledgerly/domain/transactions";
import { requireSession } from "@/platform/auth/session";
import { InterestsScreen } from "./interests-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("interests"))("title") };
}

/**
 * Interests reads everything it shows from `/api/v1` (rewrite plan R3), but the income categories of
 * the dialog's picker: their colour is the domain's rule (`colorOfCategory`), which the client cannot
 * apply yet — the same read as Subscriptions'.
 * shortcut: one server read for the picker; remove it when `GET /categories` answers the resolved
 * colour.
 */
export default async function InterestsPage() {
  return <InterestsScreen categories={await categoryOptions(await requireSession(), "income")} />;
}
