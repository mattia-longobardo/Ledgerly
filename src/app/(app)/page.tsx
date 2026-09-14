import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/platform/auth/session";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";

export default async function OverviewPage() {
  await requireSession();
  const t = await getTranslations("overview");
  return (
    <Page title={t("title")}>
      <h1 className="text-title font-semibold tracking-[-0.02em] max-md:hidden">{t("title")}</h1>
      <EmptyState
        title={t("empty.title")}
        description={t("empty.description")}
        actions={
          <Link
            href="/settings/profile"
            className="inline-flex h-8 items-center rounded-ctl border border-primary bg-primary px-3 font-medium text-primary-fg hover:brightness-[1.08]"
          >
            {t("empty.cta")}
          </Link>
        }
      />
    </Page>
  );
}
