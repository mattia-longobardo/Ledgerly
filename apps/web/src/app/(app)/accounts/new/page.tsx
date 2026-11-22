import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NewAccountForm } from "@/modules/accounts/client";
import { Card } from "@ledgerly/ui/card";
import { Page } from "@ledgerly/ui/shell/page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("accounts.new"))("title") };
}

/** "New account": the form reads what it needs from `/api/v1` (rewrite plan R3). */
export default async function NewAccountPage() {
  const t = await getTranslations("accounts.new");
  const accounts = await getTranslations("accounts");

  return (
    <Page title={t("title")} parent={{ href: "/accounts", label: accounts("title") }}>
      <h1 className="text-title font-semibold tracking-title max-md:sr-only">{t("title")}</h1>
      <p className="max-w-[560px] text-muted">{t("description")}</p>
      <Card>
        <NewAccountForm />
      </Card>
    </Page>
  );
}
