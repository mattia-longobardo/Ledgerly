import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InterestsScreen } from "./interests-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("interests"))("title") };
}

/** Interests reads everything it shows from `/api/v1` (rewrite plan R3). */
export default function InterestsPage() {
  return <InterestsScreen />;
}
