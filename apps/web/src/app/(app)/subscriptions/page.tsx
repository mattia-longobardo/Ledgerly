import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { categoryOptions } from "@ledgerly/domain/transactions";
import { requireSession } from "@/platform/auth/session";
import { SubscriptionsScreen } from "./subscriptions-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("subscriptions"))("title") };
}

/**
 * Subscriptions reads everything it shows from `/api/v1` (rewrite plan R3), but the categories of the
 * dialog's picker: their colour is the domain's rule (`colorOfCategory`, derived from the id when
 * none is chosen), which the client cannot apply yet.
 * shortcut: one server read for the picker; remove it when `@ledgerly/domain/transactions/client`
 * exports the colour rule and the screen reads `GET /categories`.
 */
export default async function SubscriptionsPage() {
  const categories = await categoryOptions(await requireSession(), "expense");
  return <SubscriptionsScreen categories={categories} />;
}
