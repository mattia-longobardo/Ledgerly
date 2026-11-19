import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import type { Ctx } from "@ledgerly/domain/platform/context";
import type { CivilDate } from "@ledgerly/domain/shared/dates";
import { SettingsGrid, SettingsSection } from "@/ui/section";
import type { FundDetail } from "@ledgerly/domain/funds";
import { FundFeesSection } from "./fund-fees";
import { FundStateButton } from "./fund-forms";
import { FundSettingsForm } from "./fund-settings-form";
import { FundSourcesSection } from "./fund-sources";

/** A section the address can point at (`#sources`), with the name the tests find it by. */
function Anchor({ id, testId, children }: { id: string; testId?: string; children: ReactNode }) {
  return (
    <div id={id} data-testid={testId} className="min-w-0 scroll-mt-4">
      {children}
    </div>
  );
}

/**
 * The Settings tab of a fund (docs/design/rewrite-plan/ux/n6-pension-fund.md §6): General, the
 * contribution sources, the fees and the danger zone, the same four for every fund. It does not
 * follow the period. An archived fund is read only: only "Restore fund" is offered.
 */
export async function FundSettings({
  ctx,
  detail,
  archived,
  todayOn,
  accounts,
  movements,
  taken,
  rebuild,
}: {
  ctx: Ctx;
  detail: FundDetail;
  archived: boolean;
  todayOn: CivilDate;
  /** The open accounts a recurring debit can be taken from. */
  accounts: readonly { id: string; name: string }[];
  /** The movements "Find from the movements" chooses from. */
  movements: readonly { id: string; label: string }[];
  /** The payslip components another fund already takes, with that fund's name. */
  taken: Record<string, string>;
  /** "Rebuild from payslips": the page gives it, it needs both modules at once. */
  rebuild: ReactNode;
}) {
  const t = await getTranslations("funds");
  const { fund } = detail;
  return (
    <SettingsGrid>
      <Anchor id="general">
        <SettingsSection title={t("settings.general.title")} description={t("settings.general.description")}>
          <FundSettingsForm
            fundId={fund.id}
            form={{
              name: fund.name,
              provider: fund.provider ?? "",
              compartment: fund.compartment ?? "",
              startOn: fund.startOn,
              code: fund.code ?? "",
            }}
            currency={detail.currency}
            today={todayOn}
            readOnly={archived}
          />
          <p className="flex flex-wrap items-center gap-x-2 border-t border-border pt-3 text-sm">
            <span>{t("settings.general.valueAccount", { account: detail.accountName })}</span>
            <Link
              href={`/accounts/${fund.valuationAccountId}?tab=settings` as Route}
              className="focus-ring inline-flex min-h-6 items-center rounded-xs font-medium text-accent hover:underline"
            >
              {t("settings.general.openAccount", { account: detail.accountName })}
            </Link>
          </p>
        </SettingsSection>
      </Anchor>

      <Anchor id="sources" testId="fund-sources">
        <SettingsSection title={t("sources.title")} description={t("sources.description")}>
          <FundSourcesSection
            ctx={ctx}
            detail={detail}
            archived={archived}
            todayOn={todayOn}
            accounts={accounts}
            movements={movements}
            taken={taken}
            rebuild={rebuild}
          />
        </SettingsSection>
      </Anchor>

      <Anchor id="fees" testId="fund-fees">
        <SettingsSection title={t("fees.title")} description={t("fees.description")}>
          <FundFeesSection ctx={ctx} detail={detail} archived={archived} todayOn={todayOn} />
        </SettingsSection>
      </Anchor>

      <Anchor id="danger">
        <SettingsSection title={t("settings.danger.title")} description={t("settings.danger.description")}>
          <p className="text-sm">{t("settings.danger.text", { name: fund.name })}</p>
          {/* A button is as wide as its label: a section's children stretch, and an «Archive fund»
              drawn across the whole card reads as a banner, not as a command. */}
          <div className="flex">
            {archived ? (
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
      </Anchor>
    </SettingsGrid>
  );
}
