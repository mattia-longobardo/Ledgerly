import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/platform/auth/session";
import { ButtonLink } from "@/ui/button";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("overview"))("title") };
}

export default async function OverviewPage() {
  await requireSession();
  const t = await getTranslations("overview");
  return (
    <Page title={t("title")}>
      <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
      <EmptyState
        title={t("empty.title")}
        description={t("empty.description")}
        actions={
          <ButtonLink href="/settings/profile" variant="primary">
            {t("empty.cta")}
          </ButtonLink>
        }
      />
    </Page>
  );
}
