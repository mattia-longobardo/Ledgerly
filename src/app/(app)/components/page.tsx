import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/platform/auth/session";
import { Page } from "@/ui/shell/page";
import { Gallery } from "./gallery";

export default async function ComponentsPage() {
  await requireAdmin();
  const t = await getTranslations("gallery");
  return (
    <Page title={t("title")}>
      <Gallery />
    </Page>
  );
}
