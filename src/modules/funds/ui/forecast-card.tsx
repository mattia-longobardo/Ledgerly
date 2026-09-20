import { getTranslations } from "next-intl/server";
import type { Ctx } from "@/platform/context";
import { formatMoney, formatPercent } from "@/platform/format";
import { Card } from "@/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import type { FundForecast } from "../rules";

/**
 * "Where this is heading" (owner, 2026-09-20): what the fund will hold in one, three, five and ten
 * years if the money keeps going in at the rhythm of the last twelve months and it grows at each
 * of the rates in the header.
 *
 * Those rates are **hypotheses** and the card says so, twice: in its own description and in the
 * column headers. The only rate that belongs to the fund is the last column, and it appears only
 * when a year of months has been measured — annualising a quarter of good weather would be the
 * most convincing lie this page could tell.
 *
 * The "Paid in" column needs neither a rate nor a valuation: the rhythm is read from what actually
 * went in, so it is the one column that is always answered.
 */
export async function ForecastCard({
  ctx,
  forecast,
  testId = "fund-forecast",
}: {
  ctx: Pick<Ctx, "numberFormat">;
  forecast: FundForecast;
  testId?: string;
}) {
  const t = await getTranslations("funds.forecast");
  const money = (cents: bigint | null) => formatMoney(cents, ctx.numberFormat, { decimals: false });
  const rate = (value: number) => formatPercent(value, ctx.numberFormat, { decimals: 1 });
  const hasValue = forecast.rows.some((row) => row.valueCents.some((cents) => cents !== null));

  return (
    <Card className="flex h-full min-w-0 flex-col gap-3" data-testid={testId}>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted">
          {forecast.monthlyCents === 0n
            ? t("noRhythm")
            : t("description", { monthly: formatMoney(forecast.monthlyCents, ctx.numberFormat) })}
        </p>
      </div>
      {/* On a phone the columns become one block per horizon: the rates are few and short, and a
          table of five columns could only be reached by dragging it sideways. */}
      {forecast.monthlyCents !== 0n && (
        <ul className="flex flex-col gap-3 md:hidden">
          {forecast.rows.map((row) => (
            <li key={row.years} className="flex flex-col gap-1 border-b border-border pb-3 last:border-0">
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{t("years", { years: row.years })}</span>
                <span className="tabular-nums">
                  {money(row.paidInCents)} <span className="text-muted">{t("paidIn").toLowerCase()}</span>
                </span>
              </span>
              <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted tabular-nums">
                {row.valueCents.map((cents, index) => (
                  <span key={forecast.rates[index]}>
                    {index === forecast.rates.length - 1 && forecast.ownRate !== null
                      ? t("ownRate", { rate: rate(forecast.rates[index]) })
                      : t("rate", { rate: rate(forecast.rates[index]) })}{" "}
                    <span className="text-fg">{money(cents)}</span>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      {forecast.monthlyCents !== 0n && (
        <div className="overflow-x-auto max-md:hidden">
          <Table>
            <THead>
              <Th>{t("horizon")}</Th>
              <Th align="right">{t("paidIn")}</Th>
              {forecast.rates.map((value, index) => (
                <Th key={value} align="right">
                  {index === forecast.rates.length - 1 && forecast.ownRate !== null
                    ? t("ownRate", { rate: rate(value) })
                    : t("rate", { rate: rate(value) })}
                </Th>
              ))}
            </THead>
            <TBody>
              {forecast.rows.map((row) => (
                <Tr key={row.years}>
                  <Td>{t("years", { years: row.years })}</Td>
                  <Td align="right" className="font-semibold">
                    {money(row.paidInCents)}
                  </Td>
                  {row.valueCents.map((cents, index) => (
                    <Td key={forecast.rates[index]} align="right" muted>
                      {money(cents)}
                    </Td>
                  ))}
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      )}
      <p className="text-sm text-faint">
        {!hasValue ? t("noValue") : forecast.ownRate === null ? t("noOwnRate") : t("ownRateNote")}
      </p>
    </Card>
  );
}
