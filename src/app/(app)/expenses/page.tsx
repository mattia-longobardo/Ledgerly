import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/platform/auth/session";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("expenses"))("title") };
}

export default async function ExpensesPage() {
  await requireSession();
  const t = await getTranslations("expenses");

  return (
    <Page title={t("title")}>
      <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
      <EmptyState title={t("unsynced.title")} description={t("unsynced.description")} />
    </Page>
  );
}
