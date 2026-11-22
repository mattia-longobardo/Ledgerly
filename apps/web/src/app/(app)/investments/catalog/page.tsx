import type { Metadata, Route } from "next";
import { getTranslations } from "next-intl/server";
import { Page } from "@ledgerly/ui/shell/page";
import { CatalogScreen } from "./catalog-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("investments"))("catalog.title") };
}

/** The catalog: the screen reads everything it shows from `/api/v1` (rewrite plan R3). */
export default async function InvestmentsCatalogPage() {
  const t = await getTranslations("investments");
  return (
    <Page title={t("catalog.title")} parent={{ href: "/investments" as Route, label: t("title") }}>
      <div className="flex flex-col gap-0.5">
        <h1 className="text-title font-semibold tracking-title">{t("catalog.title")}</h1>
        <p className="text-muted">{t("catalog.subtitle")}</p>
      </div>
      <CatalogScreen />
    </Page>
  );
}
