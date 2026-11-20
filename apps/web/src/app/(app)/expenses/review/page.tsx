import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ReviewScreen } from "./review-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("expenses.review"))("title") };
}

/** «To review» reads everything it shows from `/api/v1`. */
export default function ReviewPage() {
  return <ReviewScreen />;
}
