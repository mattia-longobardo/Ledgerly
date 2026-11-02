import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import type { Ctx } from "@/platform/context";
import type { CivilDate } from "@/platform/dates";
import { formatAmountInput, formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@/platform/format";
import { SettingsGrid, SettingsSection } from "@/ui/section";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { managementItem } from "../pension/metrics";
import type { PensionDetail } from "../pension/queries";
import {
  ContributionRuleForm,
  DeleteRuleButton,
  FeesForm,
  ReceivesPayrollButton,
  ToleranceForm,
} from "./pension-forms";
import { transferRhythm } from "./pension-present";

export const PENSION_TABS = ["overview", "contributions", "valuations", "settings"] as const;

/** The design's "Source: payslips" fields: which roles of the code map feed each component. */
const CODE_GROUPS = [
  { key: "worker", roles: ["employee_fund"] },
  { key: "employer", roles: ["employer_fund"] },
  { key: "tfr", roles: ["tfr_contribution"] },
  { key: "enrollment", roles: ["employee_fund_enrollment", "employer_fund_enrollment"] },
  { key: "adjustment", roles: ["employee_fund_adjustment", "employer_fund_adjustment"] },
] as const;

/**
 * The Settings tab of a pension fund (docs/design/funds-ux.md §6: "as today"). `rebuild` and `settingsForm`
 * come from the page: they need both modules at once.
 */
export async function PensionSettings({
  ctx,
  detail,
  today,
  rebuild,
  settingsForm,
  archiveButton,
}: {
  ctx: Ctx;
  detail: PensionDetail;
  today: CivilDate;
  rebuild: ReactNode;
  settingsForm: ReactNode;
  archiveButton: ReactNode;
}) {
  const t = await getTranslations("funds.pension");
  const { fund } = detail;
  const money = (cents: bigint | null) =>
    cents === null ? NULL_DISPLAY : formatMoney(cents, ctx.numberFormat);
  const date = (on: string | null) => (on === null ? NULL_DISPLAY : formatDate(on, "long", ctx.locale));

  const rhythm = transferRhythm(detail.schedule?.schedule ?? []);
  const tariffOf = (item: string) => detail.tariffs.find((row) => row.item === item) ?? null;
  const tariffAmount = (item: string) => {
    const row = tariffOf(item);
    return row?.amountCents === null || row === null ? NULL_DISPLAY : money(row.amountCents);
  };
  const managementTariff = tariffOf(managementItem(detail.compartment));
  const newest = detail.tariffs[0] ?? null;

  /**
   * Settings (spec §8.2): short sections two by two as soon as the column allows it, tables across
   * the whole width. The order pairs them by height — the two forms, then the two lists of figures,
   * then the two one-line sections — so no card is left half empty beside a tall neighbour.
   */
  return (
    <SettingsGrid>
      <SettingsSection title={t("settings.general")} description={t("settings.generalDescription")}>
        {settingsForm}
      </SettingsSection>

      <SettingsSection title={t("settings.payroll")} description={t("settings.payrollDescription")}>
        <p className="text-sm">{fund.receivesPayroll ? t("settings.payrollOn") : t("settings.payrollOff")}</p>
        <div className="flex flex-wrap gap-2">
          {!fund.receivesPayroll && (
            <ReceivesPayrollButton
              fundId={fund.id}
              label={t("settings.takePayroll")}
              toast={t("settings.saved")}
            />
          )}
          {fund.receivesPayroll && rebuild}
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <span className="text-sm font-medium">{t("settings.codesTitle")}</span>
          <dl className="flex flex-col gap-1 text-sm">
            {CODE_GROUPS.map((group) => {
              const codes = group.roles.flatMap((role) => detail.codes[role] ?? []);
              return (
                <Line
                  key={group.key}
                  label={t(`settings.codeGroups.${group.key}` as "settings.codeGroups.worker")}
                  value={codes.length > 0 ? codes.join(", ") : NULL_DISPLAY}
                />
              );
            })}
          </dl>
          <p className="text-sm text-muted">{t("settings.codes")}</p>
          <Link
            href={"/payroll/settings" as Route}
            className="inline-flex h-6 items-center self-start text-sm font-medium text-accent hover:underline"
          >
            {t("settings.openCodeMap")}
          </Link>
        </div>
      </SettingsSection>

      <SettingsSection title={t("settings.transfers")} description={t("settings.transfersDescription")}>
        {detail.schedule === null ? (
          <p className="text-sm text-muted">{t("settings.noSchedule")}</p>
        ) : (
          <>
            <dl className="flex flex-col gap-2 text-sm">
              <Line
                label={t("settings.frequency")}
                value={t(`settings.frequencies.${rhythm.frequency}` as "settings.frequencies.quarterly")}
              />
              <Line
                label={t("settings.dueDay")}
                value={rhythm.day === null ? NULL_DISPLAY : String(rhythm.day)}
                note={t("settings.schedule", {
                  dates: (detail.schedule.schedule ?? [])
                    .map((entry) => `${entry.day}/${entry.month}${entry.nextYear ? "+1" : ""}`)
                    .join(" · "),
                })}
              />
            </dl>
            {detail.schedule.source && (
              <p className="text-sm text-muted">
                {t("settings.source", {
                  source: detail.schedule.source,
                  date: date(detail.schedule.verifiedOn),
                })}
              </p>
            )}
          </>
        )}
        <p className="text-sm text-muted">{t("settings.ruleOnly")}</p>
        <ToleranceForm fundId={fund.id} days={detail.schedule?.toleranceDays ?? 15} />
      </SettingsSection>

      <SettingsSection title={t("settings.fees")} description={t("settings.feesDescription")}>
        {detail.tariffs.length === 0 ? (
          <p className="text-sm text-muted">{t("settings.noTariff")}</p>
        ) : (
          <>
            <dl className="flex flex-col gap-2 text-sm">
              <Line
                label={t("settings.feeItems.enrollmentWorker")}
                value={tariffAmount("enrollment_worker")}
                note={t("settings.feeUnits.once")}
              />
              <Line
                label={t("settings.feeItems.enrollmentEmployer")}
                value={tariffAmount("enrollment_employer")}
                note={t("settings.feeUnits.once")}
              />
              <Line
                label={t("settings.feeItems.association")}
                value={tariffAmount("association")}
                note={t("settings.feeUnits.year")}
              />
              <Line
                label={t("settings.feeItems.management")}
                value={
                  managementTariff?.rate
                    ? formatPercent(Number(managementTariff.rate), ctx.numberFormat)
                    : NULL_DISPLAY
                }
                note={detail.compartment ?? t("settings.feeUnits.yearOfAssets")}
              />
            </dl>
            {newest && (
              <p className="text-sm text-muted">
                {t("settings.tariffFrom", {
                  provider: fund.provider ?? newest.provider,
                  date: date(newest.validFrom),
                })}
              </p>
            )}
          </>
        )}
        <p className="text-sm text-muted">{t("settings.feesActual")}</p>
        <FeesForm
          fundId={fund.id}
          enrollment={formatAmountInput(detail.schedule?.enrollmentFeeCents ?? 0n, ctx.numberFormat)}
          quarter={formatAmountInput(detail.schedule?.quarterFeeCents ?? 0n, ctx.numberFormat)}
        />
      </SettingsSection>

      <SettingsSection title={t("settings.rules")} description={t("settings.rulesDescription")}>
        {detail.contributionRules.length > 0 && (
          <Table>
            <THead>
              <Th>{t("settings.from")}</Th>
              <Th>{t("settings.ccnl")}</Th>
              <Th align="right">{t("settings.worker")}</Th>
              <Th align="right">{t("settings.employer")}</Th>
              <Th align="right">{t("settings.tfrShare")}</Th>
              <Th>{t("settings.sourceColumn")}</Th>
              <Th align="right">
                <span className="sr-only">{t("settings.removeRule")}</span>
              </Th>
            </THead>
            <TBody>
              {detail.contributionRules.map((rule) => (
                <Tr key={rule.id} data-testid="rule-row">
                  <Td muted>{date(rule.validFrom)}</Td>
                  <Td>{rule.ccnl ?? NULL_DISPLAY}</Td>
                  <Td align="right">{rule.workerPct ?? NULL_DISPLAY}</Td>
                  <Td align="right">{rule.employerPct ?? NULL_DISPLAY}</Td>
                  <Td align="right">{rule.tfrPct ?? NULL_DISPLAY}</Td>
                  <Td muted className="max-w-[240px] truncate">
                    {rule.source ?? NULL_DISPLAY}
                  </Td>
                  <Td align="right">
                    <span className="flex justify-end gap-1">
                      <DeleteRuleButton fundId={fund.id} ruleId={rule.id} label={t("settings.removeRule")} />
                    </span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        {/* Open, not folded: this whole page is the fund's settings, nothing here needs hiding. */}
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">{t("settings.addRule")}</h3>
          <ContributionRuleForm fundId={fund.id} today={today} />
        </div>
      </SettingsSection>

      <SettingsSection
        title={t("settings.valuationAccount")}
        description={t("settings.valuationDescription")}
      >
        <Link
          href={`/accounts/${fund.valuationAccountId}?tab=settings` as Route}
          className="inline-flex h-6 items-center self-start font-medium text-accent hover:underline"
        >
          {t("settings.openAccount", { account: detail.accountName })}
        </Link>
      </SettingsSection>

      <SettingsSection title={t("settings.danger")} description={t("settings.dangerDescription")}>
        {/* A button is as wide as its label: a section's children stretch, and an «Archive fund»
            drawn across the whole card reads as a banner, not as a command. */}
        <div className="flex">{archiveButton}</div>
      </SettingsSection>
    </SettingsGrid>
  );
}

function Line({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="flex flex-col items-end">
        <span className="font-medium tabular-nums">{value}</span>
        {note && <span className="text-xs text-muted">{note}</span>}
      </dd>
    </div>
  );
}
