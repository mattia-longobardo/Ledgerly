import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccountForm } from "@/modules/accounts/ui/account-form";
import { requireSession } from "@/platform/auth/session";
import { today } from "@/platform/dates";
import { Card } from "@/ui/card";
import { Page } from "@/ui/shell/page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("accounts.new"))("title") };
}

export default async function NewAccountPage() {
  const ctx = await requireSession();
  const t = await getTranslations("accounts.new");
  const accounts = await getTranslations("accounts");

  return (
    <Page title={t("title")} parent={{ href: "/accounts", label: accounts("title") }}>
      <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
      <p className="max-w-[560px] text-muted">{t("description")}</p>
      <Card className="max-w-[720px]">
        <AccountForm today={today(ctx.timeZone)} />
      </Card>
    </Page>
  );
}
