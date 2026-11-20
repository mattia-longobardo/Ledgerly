import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { OverviewScreen } from "./overview-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("overview"))("title") };
}

/** Overview reads everything it shows from `/api/v1` (rewrite plan R3). */
export default function OverviewPage() {
  return <OverviewScreen />;
}
