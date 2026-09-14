import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/platform/auth/session";
import { Page } from "@/ui/shell/page";
import { Gallery } from "./gallery";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("gallery"))("title") };
}

export default async function ComponentsPage() {
  await requireAdmin();
  const t = await getTranslations("gallery");
  return (
    <Page title={t("title")}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
          {/* It points at the topbar theme toggle, which phones do not show. */}
          <p className="mt-0.5 text-muted max-md:hidden">{t("description")}</p>
        </div>
        <Gallery />
      </div>
    </Page>
  );
}
