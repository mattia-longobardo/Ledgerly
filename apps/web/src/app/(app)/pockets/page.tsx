import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PocketsScreen } from "./pockets-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("pockets"))("title") };
}

/** Pockets reads everything it shows from `/api/v1` (rewrite plan R3). */
export default function PocketsPage() {
  return <PocketsScreen />;
}
