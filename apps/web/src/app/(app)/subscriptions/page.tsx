import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SubscriptionsScreen } from "./subscriptions-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("subscriptions"))("title") };
}

/** Subscriptions reads everything it shows from `/api/v1` (rewrite plan R3). */
export default function SubscriptionsPage() {
  return <SubscriptionsScreen />;
}
