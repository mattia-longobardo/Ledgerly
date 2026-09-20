import type { Metadata, Route } from "next";
import { getTranslations } from "next-intl/server";
import { fundDetail } from "@/modules/funds/queries";
import { pensionDetail } from "@/modules/funds/pension/queries";
import { requireFund } from "@/modules/funds/service";
import { requireSession } from "@/platform/auth/session";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@/platform/format";
import { annualisedOverPeriods, type PeriodReturn, periodStats } from "@/modules/funds/rules";
import { Card } from "@/ui/card";
import { Bars } from "@/ui/chart";
import { KpiTile } from "@/ui/kpi-tile";
import { Page } from "@/ui/shell/page";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { TONE_TEXT, toneOfSign } from "@/ui/tone";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("funds.returns");
  return { title: `${t("page.title")} · Ledgerly` };
}

/**
 * The fund's return, stretch by stretch (spec §7.7, owner 2026-09-20): the page the card on the
 * fund links to, for when the three numbers under the little chart are not enough.
 *
 * One row per stretch between two documented values, so every figure on it can be checked by hand:
 * the two values, the money paid in between them, the gain that is left and what that is of the
 * money at work. Nothing here is annualised except the one line that says it is, and that line
 * appears only with a year of history behind it.
 */
export default async function FundReturnsPage({ params }: PageProps<"/funds/[id]/returns">) {
  const { id } = await params;
  const ctx = await requireSession();
  const t = await getTranslations("funds.returns");
  const fund = await requireFund(ctx, id);

  const periods: PeriodReturn[] =
    fund.type === "pension" ? (await pensionDetail(ctx, id)).periods : (await fundDetail(ctx, id)).periods;
  const stats = periodStats(periods);
  const annual = annualisedOverPeriods(periods);

  const money = (cents: bigint | null) => formatMoney(cents, ctx.numberFormat);
  const percent = (value: number | null) =>
    value === null ? NULL_DISPLAY : formatPercent(value, ctx.numberFormat, { signed: true });
  const day = (on: string) => formatDate(on as never, "long", ctx.locale);
  // The colour of a rate is its sign's, whatever the tile is called.
  const toneOf = (value: number | null) =>
    value === null || value === 0 ? ("muted" as const) : value > 0 ? ("pos" as const) : ("neg" as const);

  return (
    <Page
      title={`${fund.name} · ${t("page.title")}`}
      parent={{ href: `/funds/${fund.id}` as Route, label: t("page.back") }}
    >
      <div className="flex w-full flex-col gap-4">
        <h1 className="text-title font-semibold tracking-[-0.02em]">
          {fund.name} · {t("page.title")}
        </h1>
        <p className="max-w-[70ch] text-muted">{t("page.description")}</p>

        <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
          <KpiTile
            label={t("page.compounded")}
            value={percent(stats.compounded)}
            valueTone={toneOfSign(
              stats.compounded === null ? null : BigInt(Math.round(stats.compounded * 100)),
            )}
            note={t("since", { days: stats.days })}
          />
          <KpiTile
            label={t("page.annualised")}
            value={percent(annual)}
            note={annual === null ? t("page.noAnnualised") : t("since", { days: stats.days })}
          />
          <KpiTile
            label={t("best")}
            value={percent(stats.best?.fraction ?? null)}
            valueTone={toneOf(stats.best?.fraction ?? null)}
          />
          <KpiTile
            label={t("worst")}
            value={percent(stats.worst?.fraction ?? null)}
            valueTone={toneOf(stats.worst?.fraction ?? null)}
          />
        </div>

        {periods.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">{t("empty")}</p>
          </Card>
        ) : (
          <>
            <Card className="flex flex-col gap-3" data-testid="returns-chart">
              <Bars
                values={periods.map((period) => period.fraction * 100)}
                yLabels={[]}
                xLabels={[day(periods[0].from), day(periods[periods.length - 1].to)]}
                summary={periods
                  .map((period) => `${day(period.from)} → ${day(period.to)} ${percent(period.fraction)}`)
                  .join(", ")}
                height={220}
                hover={periods.map((period) => ({
                  label: `${day(period.from)} → ${day(period.to)}`,
                  value: percent(period.fraction),
                  note: t("hover", { gain: money(period.gainCents), paidIn: money(period.flowsCents) }),
                  rows: [
                    { label: t("page.start"), value: money(period.fromCents), color: "var(--muted)" },
                    { label: t("page.end"), value: money(period.toCents), color: "var(--accent)" },
                  ],
                }))}
              />
            </Card>

            <Card padded={false} data-testid="returns-table">
              {/* On a phone the eight columns become a list, as every other table here does. */}
              <ul className="flex flex-col md:hidden">
                {[...periods].reverse().map((period) => (
                  <li
                    key={`${period.from}-${period.to}`}
                    data-testid="return-item"
                    className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 last:border-0"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">
                        {day(period.from)} → {day(period.to)}
                      </span>
                      <span className="text-sm text-muted">
                        {t("page.days")} {period.days} · {money(period.flowsCents)} {t("page.flows")}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end tabular-nums">
                      <span className={`font-semibold ${TONE_TEXT[toneOfSign(period.gainCents)]}`}>
                        {percent(period.fraction)}
                      </span>
                      <span className="text-sm text-muted">
                        {formatMoney(period.gainCents, ctx.numberFormat, { signed: true })}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="overflow-x-auto max-md:hidden">
                <Table>
                  <THead>
                    <Th>{t("page.from")}</Th>
                    <Th>{t("page.to")}</Th>
                    <Th align="right">{t("page.days")}</Th>
                    <Th align="right">{t("page.start")}</Th>
                    <Th align="right">{t("page.flows")}</Th>
                    <Th align="right">{t("page.end")}</Th>
                    <Th align="right">{t("page.gain")}</Th>
                    <Th align="right">{t("page.rate")}</Th>
                  </THead>
                  <TBody>
                    {[...periods].reverse().map((period) => (
                      <Tr key={`${period.from}-${period.to}`} data-testid="return-row">
                        <Td muted>{day(period.from)}</Td>
                        <Td muted>{day(period.to)}</Td>
                        <Td align="right" muted>
                          {period.days}
                        </Td>
                        <Td align="right">{money(period.fromCents)}</Td>
                        <Td align="right" muted>
                          {money(period.flowsCents)}
                        </Td>
                        <Td align="right">{money(period.toCents)}</Td>
                        <Td align="right" className={TONE_TEXT[toneOfSign(period.gainCents)]}>
                          {formatMoney(period.gainCents, ctx.numberFormat, { signed: true })}
                        </Td>
                        <Td
                          align="right"
                          className={`font-semibold ${TONE_TEXT[toneOfSign(period.gainCents)]}`}
                        >
                          {percent(period.fraction)}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </div>
            </Card>
          </>
        )}
      </div>
    </Page>
  );
}
