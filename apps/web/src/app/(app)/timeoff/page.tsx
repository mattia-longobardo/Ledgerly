import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TimeOffScreen } from "./timeoff-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("timeoff"))("title") };
}

/** Time off reads everything it shows from `/api/v1` (rewrite plan R3), the external calendar's figures too. */
export default function TimeOffPage() {
  return <TimeOffScreen />;
}
