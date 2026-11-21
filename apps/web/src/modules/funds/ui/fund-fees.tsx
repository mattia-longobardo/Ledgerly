"use client";

import { useTranslations } from "next-intl";
import { formatDate, formatMoney, formatPercent } from "@ledgerly/format/format";
import type { FeeScopeOption } from "./fee-text";
import type { Settings } from "./fund-settings";
import { FundFeesList } from "./fund-fees-client";
import type { Say } from "./say";
import { cents, feeFormOfRow } from "./wire-forms";

/**
 * Settings › Fees (docs/design/rewrite-plan/ux/n6-pension-fund.md §6.3, §7): the content of the
 * section, without its title. The list in the server's order, "Add fee", and under them what the fees
 * on assets cost in a year, estimated by the server on the fund's last value: shown and never
 * subtracted, it is already in the value.
 */
export function FundFeesSection({ settings, say }: { settings: Settings; say: Say }) {
  const t = useTranslations("funds.fees");
  const ts = useTranslations("funds.sources");
  const { format, locale } = say;
  const { fund, fees, sources, assetsEstimate: estimated } = settings;
  const { currency } = fund;

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

  const estimate =
    estimated.state === "none"
      ? null
      : estimated.state === "needs_value"
        ? t("estimateNeedsValue")
        : t("estimate", {
            amount: formatMoney(cents(estimated.amount), format, { currency }),
            rate: formatPercent(estimated.rate, format, { decimals: 2 }),
            value: formatMoney(cents(estimated.value), format, { currency }),
            date: formatDate(estimated.on, "long", locale),
          });

  return (
    <FundFeesList
      fundId={fund.id}
      fees={fees.map((fee) => feeFormOfRow(fee, format))}
      expired={new Set(fees.filter((fee) => fee.expired).map((fee) => fee.id))}
      scopes={scopes}
      todayOn={say.todayOn}
      format={format}
      locale={locale}
      currency={currency}
      readOnly={fund.state === "archived"}
    >
      {estimate && <p className="min-w-0 basis-full text-sm text-muted">{estimate}</p>}
    </FundFeesList>
  );
}
