import { getTranslations } from "next-intl/server";
import type { Ctx } from "@/platform/context";
import { formatMoney, formatPercent } from "@/platform/format";
import { Card } from "@/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { FORECAST_RATES, type FundForecast } from "../rules";

const SHORT_YEARS: readonly number[] = [5, 10];
/** The middle hypothesis: the short card names one rate. */
const SHORT_RATE = FORECAST_RATES.indexOf(0.04);
const DETAILS_SUMMARY = "focus-ring inline-flex min-h-6 cursor-pointer items-center rounded-[4px]";

/** Every horizon at every rate: a table, and on a phone one block per horizon. */
async function ProjectionTable({
  ctx,
  forecast,
}: {
  ctx: Pick<Ctx, "numberFormat">;
  forecast: FundForecast;
}) {
  const t = await getTranslations("funds.forecast");
  const money = (cents: bigint | null) => formatMoney(cents, ctx.numberFormat, { decimals: false });
  const rate = (value: number) => formatPercent(value, ctx.numberFormat, { decimals: 1 });
  return (
    <>
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
                  {t("rate", { rate: rate(forecast.rates[index]) })}{" "}
                  <span className="text-fg">{money(cents)}</span>
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
    </>
  );
}

/** What a projection says it stands on: always as of today, whatever the period (§6). */
async function ProjectionNote({
  ctx,
  forecast,
  plan,
}: {
  ctx: Pick<Ctx, "numberFormat">;
  forecast: FundForecast;
  plan: boolean;
}) {
  const t = await getTranslations("funds.fund.projection");
  const tf = await getTranslations("funds.forecast");
  const monthly = formatMoney(forecast.monthlyCents, ctx.numberFormat);
  const hasValue = forecast.rows.some((row) => row.valueCents.some((cents) => cents !== null));
  return (
    <>
      <p className="text-sm text-muted">
        {forecast.monthlyCents === 0n
          ? tf("noRhythm")
          : plan
            ? t("onPlan", { monthly })
            : t("onAverage", { monthly })}
      </p>
      {!hasValue && <p className="text-sm text-muted">{tf("noValue")}</p>}
    </>
  );
}

/** The pension fund's projection: closed, since the horizon of a pension is not the page's first question. */
export async function ClosedProjection({
  ctx,
  forecast,
}: {
  ctx: Pick<Ctx, "numberFormat">;
  forecast: FundForecast;
}) {
  const t = await getTranslations("funds.fund.projection");
  const tf = await getTranslations("funds.forecast");
  return (
    <Card>
      <details data-testid="fund-projection" className="flex flex-col gap-3">
        <summary className={`${DETAILS_SUMMARY} flex-wrap gap-x-2`}>
          <span className="font-semibold">{tf("title")}</span>
          <span className="text-sm text-muted">{t("horizons")}</span>
        </summary>
        <div className="flex flex-col gap-3 pt-3">
          <ProjectionNote ctx={ctx} forecast={forecast} plan={false} />
          {forecast.monthlyCents !== 0n && <ProjectionTable ctx={ctx} forecast={forecast} />}
        </div>
      </details>
    </Card>
  );
}

/** A PAC's projection: two lines on the plan, and every rate one click away. */
export async function ShortProjection({
  ctx,
  forecast,
  plan,
}: {
  ctx: Pick<Ctx, "numberFormat">;
  forecast: FundForecast;
  plan: boolean;
}) {
  const t = await getTranslations("funds.fund.projection");
  const tf = await getTranslations("funds.forecast");
  const money = (cents: bigint | null) => formatMoney(cents, ctx.numberFormat, { decimals: false });
  const rate = formatPercent(forecast.rates[SHORT_RATE], ctx.numberFormat, { decimals: 1 });
  return (
    <Card className="flex h-full min-w-0 flex-col gap-3" data-testid="fund-projection">
      <h2 className="text-lg font-semibold">{tf("title")}</h2>
      <ProjectionNote ctx={ctx} forecast={forecast} plan={plan} />
      {forecast.monthlyCents !== 0n && (
        <>
          <dl className="flex flex-col gap-1 text-sm">
            {forecast.rows
              .filter((row) => SHORT_YEARS.includes(row.years))
              .map((row) => (
                <div key={row.years} className="flex items-baseline justify-between gap-3">
                  <dt>{t("short", { years: row.years, rate })}</dt>
                  <dd className="font-semibold tabular-nums">{money(row.valueCents[SHORT_RATE])}</dd>
                </div>
              ))}
          </dl>
          <details className="text-sm">
            <summary className={`${DETAILS_SUMMARY} text-muted hover:text-fg`}>{t("allRates")}</summary>
            <div className="pt-2">
              <ProjectionTable ctx={ctx} forecast={forecast} />
            </div>
          </details>
        </>
      )}
    </Card>
  );
}
