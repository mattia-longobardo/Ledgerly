import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Ctx } from "@/platform/context";
import { SettingsGrid, SettingsSection } from "@/ui/section";
import type { FundDetail } from "../queries";
import { DepositRuleForm, FundSettingsForm, FundStateButton } from "./fund-forms";
import { fundDraft } from "./present";

/** A PAC's settings (§6: "as today"), which do not follow the period. */
export async function PacSettings({ ctx, detail }: { ctx: Pick<Ctx, "numberFormat">; detail: FundDetail }) {
  const t = await getTranslations("funds");
  const { fund } = detail;
  return (
    <SettingsGrid>
      <SettingsSection title={t("settings.general.title")} description={t("settings.plan.description")}>
        <FundSettingsForm
          fundId={fund.id}
          draft={fundDraft(fund, ctx.numberFormat)}
          accounts={detail.accounts}
        />
      </SettingsSection>
      <SettingsSection title={t("settings.rule.title")} description={t("settings.rule.description")}>
        <DepositRuleForm
          fundId={fund.id}
          draft={{
            payeeMatch: detail.rule?.payeeMatch ?? fund.provider ?? "",
            accountId: detail.rule?.accountId ?? fund.debitAccountId ?? "",
            active: detail.rule?.active ?? true,
          }}
          accounts={detail.accounts}
        />
      </SettingsSection>
      <SettingsSection
        title={t("settings.valuations.title")}
        description={t("settings.valuations.description")}
      >
        <Link
          href={`/accounts/${fund.valuationAccountId}?tab=settings` as Route}
          className="inline-flex h-6 items-center self-start font-medium text-accent hover:underline"
        >
          {t("settings.valuations.open", { account: detail.accountName })}
        </Link>
      </SettingsSection>
      <SettingsSection title={t("settings.danger.title")} description={t("settings.danger.description")}>
        <p className="text-sm">{t("settings.danger.text", { name: fund.name })}</p>
        <div>
          {fund.state === "archived" ? (
            <FundStateButton
              fundId={fund.id}
              state="active"
              label={t("settings.danger.restore")}
              toast={t("toasts.restored")}
            />
          ) : (
            <FundStateButton
              fundId={fund.id}
              state="archived"
              label={t("settings.danger.archive")}
              toast={t("toasts.archived")}
            />
          )}
        </div>
      </SettingsSection>
    </SettingsGrid>
  );
}
