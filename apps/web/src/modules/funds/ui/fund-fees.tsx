import { getTranslations } from "next-intl/server";
import type { Ctx } from "@ledgerly/domain/platform/context";
import type { CivilDate } from "@ledgerly/domain/platform/dates";
import { formatDate, formatMoney, formatPercent } from "@ledgerly/domain/platform/format";
import { assetsCost, feeValidOn } from "@ledgerly/domain/funds";
import { feeFormOf } from "@ledgerly/domain/funds";
import type { FundDetail } from "@ledgerly/domain/funds";
import type { FeeScopeOption } from "./fee-text";
import { FundFeesList } from "./fund-fees-client";

/**
 * Settings › Fees (docs/design/rewrite-plan/ux/n6-pension-fund.md §6.3, §7): the content of the
 * section, without its title. The list, "Add fee", and under them what the fees on assets cost in a
 * year, estimated on the fund's last value: shown and never subtracted, it is already in the value.
 */
export async function FundFeesSection({
  ctx,
  detail,
  archived,
  todayOn,
}: {
  ctx: Ctx;
  detail: FundDetail;
  archived: boolean;
  todayOn: CivilDate;
}) {
  const t = await getTranslations("funds.fees");
  const ts = await getTranslations("funds.sources");
  const { numberFormat: format, locale } = ctx;
  const { currency, fees, sources } = detail;

  // "Applies to": each source, and each component of a payslip source. Two sources of one kind are
  // told apart by what only one of them has: the employer, the account, or their place.
  const names = sources.map((source) => {
    const twins = sources.filter((one) => one.kind === source.kind);
    if (twins.length === 1) return ts(`kinds.${source.kind}`);
    const mark = source.employer ?? source.payeeMatch ?? String(twins.indexOf(source) + 1);
    return `${ts(`kinds.${source.kind}`)} (${mark})`;
  });
  const scopes: FeeScopeOption[] = sources.flatMap((source, index) => [
    { value: source.id, label: names[index] },
    ...(source.kind === "payroll"
      ? (source.components ?? []).map((component) => ({
          value: `${source.id}:${component}`,
          label: t("scope.component", { source: names[index], component: ts(`components.${component}`) }),
        }))
      : []),
  ]);

  const value = detail.metrics.value;
  const onAssets = fees.some(
    (fee) => fee.basis === "on_assets" && fee.rate !== null && feeValidOn(fee, todayOn),
  );
  const cost = value === null ? null : assetsCost(fees, value.cents, todayOn);
  const estimate = !onAssets
    ? null
    : value === null || cost === null
      ? t("estimateNeedsValue")
      : t("estimate", {
          amount: formatMoney(cost.cents, format, { currency }),
          rate: formatPercent(cost.rate, format, { decimals: 2 }),
          value: formatMoney(value.cents, format, { currency }),
          date: formatDate(value.on, "long", locale),
        });

  return (
    <FundFeesList
      fundId={detail.fund.id}
      fees={fees.map((fee) => feeFormOf(fee, format))}
      scopes={scopes}
      todayOn={todayOn}
      format={format}
      locale={locale}
      currency={currency}
      readOnly={archived}
    >
      {estimate && <p className="min-w-0 basis-full text-sm text-muted">{estimate}</p>}
    </FundFeesList>
  );
}
