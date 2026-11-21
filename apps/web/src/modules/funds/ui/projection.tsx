"use client";

import { useTranslations } from "next-intl";
import type { RouteOutput } from "@ledgerly/api-client";
import type { funds } from "@ledgerly/api-contract/funds";
import { formatMoney, formatPercent, type NumberFormat } from "@ledgerly/format/format";
import { Card } from "@ledgerly/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@ledgerly/ui/table";
import { cents } from "./wire-forms";

/** The projection of `GET /funds/{id}` (funds-ux §7): the server's rows, at the server's rates. */
type FundForecast = RouteOutput<typeof funds.getFund>["forecast"];

const SHORT_YEARS: readonly number[] = [5, 10];
/** The middle hypothesis: the short card names one rate. */
const shortRate = (forecast: FundForecast) => forecast.rates.indexOf(0.04);
const noRhythm = (forecast: FundForecast) => cents(forecast.monthly) === 0n;
const DETAILS_SUMMARY = "focus-ring inline-flex min-h-6 cursor-pointer items-center rounded-sm";

/** Every horizon at every rate: a table, and on a phone one block per horizon. */
function ProjectionTable({ format, forecast }: { format: NumberFormat; forecast: FundForecast }) {
  const t = useTranslations("funds.forecast");
  const money = (amount: string | null) => formatMoney(cents(amount), format, { decimals: false });
  const rate = (value: number) => formatPercent(value, format, { decimals: 1 });
  return (
    <>
      <ul className="flex flex-col gap-3 md:hidden">
        {forecast.rows.map((row) => (
          <li key={row.years} className="flex flex-col gap-1 border-b border-border pb-3 last:border-0">
            <span className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{t("years", { years: row.years })}</span>
              <span className="tabular-nums">
                {money(row.paidIn)} <span className="text-muted">{t("paidIn").toLowerCase()}</span>
              </span>
            </span>
            <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted tabular-nums">
              {row.values.map((value, index) => (
                <span key={forecast.rates[index]}>
                  {t("rate", { rate: rate(forecast.rates[index]) })}{" "}
                  <span className="text-fg">{money(value)}</span>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <div className="overflow-x-auto max-md:hidden">
        <Table>
          <THead>
            <Th>{t("horizon")}</Th>
            <Th align="right">{t("paidIn")}</Th>
            {forecast.rates.map((value) => (
              <Th key={value} align="right">
                {t("rate", { rate: rate(value) })}
              </Th>
            ))}
          </THead>
          <TBody>
            {forecast.rows.map((row) => (
              <Tr key={row.years}>
                <Td>{t("years", { years: row.years })}</Td>
                <Td align="right" className="font-semibold">
                  {money(row.paidIn)}
                </Td>
                {row.values.map((value, index) => (
                  <Td key={forecast.rates[index]} align="right" muted>
                    {money(value)}
                  </Td>
                ))}
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>
    </>
  );
}

/** What a projection says it stands on: always as of today, whatever the period (§6). */
function ProjectionNote({
  format,
  forecast,
  plan,
}: {
  format: NumberFormat;
  forecast: FundForecast;
  plan: boolean;
}) {
  const t = useTranslations("funds.fund.projection");
  const tf = useTranslations("funds.forecast");
  const monthly = formatMoney(cents(forecast.monthly), format);
  const hasValue = forecast.rows.some((row) => row.values.some((value) => value !== null));
  return (
    <>
      <p className="text-sm text-muted">
        {noRhythm(forecast) ? tf("noRhythm") : plan ? t("onPlan", { monthly }) : t("onAverage", { monthly })}
      </p>
      {!hasValue && <p className="text-sm text-muted">{tf("noValue")}</p>}
    </>
  );
}

/** The pension fund's projection: closed, since the horizon of a pension is not the page's first question. */
export function ClosedProjection({ format, forecast }: { format: NumberFormat; forecast: FundForecast }) {
  const t = useTranslations("funds.fund.projection");
  const tf = useTranslations("funds.forecast");
  return (
    <Card>
      <details data-testid="fund-projection" className="flex flex-col gap-3">
        <summary className={`${DETAILS_SUMMARY} flex-wrap gap-x-2`}>
          <span className="font-semibold">{tf("title")}</span>
          <span className="text-sm text-muted">{t("horizons")}</span>
        </summary>
        <div className="flex flex-col gap-3 pt-3">
          <ProjectionNote format={format} forecast={forecast} plan={false} />
          {!noRhythm(forecast) && <ProjectionTable format={format} forecast={forecast} />}
        </div>
      </details>
    </Card>
  );
}

/** The projection of a fund with a recurring debit: two lines on the plan, and every rate one click away. */
export function ShortProjection({ format, forecast }: { format: NumberFormat; forecast: FundForecast }) {
  const t = useTranslations("funds.fund.projection");
  const tf = useTranslations("funds.forecast");
  const money = (amount: string | null) => formatMoney(cents(amount), format, { decimals: false });
  const short = shortRate(forecast);
  const rate = formatPercent(forecast.rates[short], format, { decimals: 1 });
  return (
    <Card className="flex h-full min-w-0 flex-col gap-3" data-testid="fund-projection">
      <h2 className="text-lg font-semibold">{tf("title")}</h2>
      <ProjectionNote format={format} forecast={forecast} plan={forecast.basis === "plan"} />
      {!noRhythm(forecast) && (
        <>
          <dl className="flex flex-col gap-1 text-sm">
            {forecast.rows
              .filter((row) => SHORT_YEARS.includes(row.years))
              .map((row) => (
                <div key={row.years} className="flex items-baseline justify-between gap-3">
                  <dt>{t("short", { years: row.years, rate })}</dt>
                  <dd className="font-semibold tabular-nums">{money(row.values[short] ?? null)}</dd>
                </div>
              ))}
          </dl>
          <details className="text-sm">
            <summary className={`${DETAILS_SUMMARY} text-muted hover:text-fg`}>{t("allRates")}</summary>
            <div className="pt-2">
              <ProjectionTable format={format} forecast={forecast} />
            </div>
          </details>
        </>
      )}
    </Card>
  );
}
