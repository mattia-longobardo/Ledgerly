import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Ctx } from "@/platform/context";
import { formatDate, formatMoney, formatPercent, NULL_DISPLAY } from "@/platform/format";
import { Card } from "@/ui/card";
import { Bars } from "@/ui/chart";
import { TONE_TEXT } from "@/ui/tone";
import type { PeriodReturn, periodStats } from "../rules";

/**
 * "Return between valuations" (spec §7.7, owner 2026-09-20): one bar per stretch between two
 * documented values, gains above the line and losses below, with what each stretch was made of
 * under the pointer.
 *
 * Not one bar per calendar month. A fund is valued when a statement or a valuation says so, and
 * between two of those there is no month end to measure: measuring them against a value held
 * forward is what produced "+150 % best month, −59 % worst" on a fund whose value had simply not
 * been read since the credit landed.
 */
export async function ReturnsCard({
  ctx,
  periods,
  stats,
  href,
  testId = "fund-returns",
}: {
  ctx: Pick<Ctx, "numberFormat" | "locale">;
  periods: readonly PeriodReturn[];
  stats: ReturnType<typeof periodStats>;
  /** The detail page this card is a summary of. */
  href: Route;
  testId?: string;
}) {
  const t = await getTranslations("funds.returns");
  const percent = (value: number | null) =>
    value === null ? NULL_DISPLAY : formatPercent(value, ctx.numberFormat, { signed: true });
  const money = (cents: bigint | null) => formatMoney(cents, ctx.numberFormat);
  const day = (on: string) => formatDate(on as never, "long", ctx.locale);
  const span = (period: PeriodReturn) => `${day(period.from)} → ${day(period.to)}`;
  const toneOf = (value: number | null) =>
    value === null || value === 0 ? "muted" : value > 0 ? "pos" : "neg";

  return (
    <Card className="flex h-full min-w-0 flex-col gap-3" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <Link
          href={href}
          className="focus-ring inline-flex h-6 items-center rounded-[2px] text-sm font-medium text-accent hover:underline"
        >
          {t("details")}
        </Link>
      </div>
      {periods.length === 0 ? (
        <p className="text-sm text-muted">{t("empty")}</p>
      ) : (
        <>
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="text-kpi font-semibold tracking-[-0.01em] tabular-nums">
              {percent(stats.compounded)}
            </span>
            <span className="text-muted">{t("since", { days: stats.days })}</span>
          </p>
          <Bars
            values={periods.map((period) => period.fraction * 100)}
            yLabels={[]}
            xLabels={[day(periods[0].from), day(periods[periods.length - 1].to)]}
            summary={periods.map((period) => `${span(period)} ${percent(period.fraction)}`).join(", ")}
            height={100}
            hover={periods.map((period) => ({
              label: span(period),
              value: percent(period.fraction),
              note: t("hover", {
                gain: money(period.gainCents),
                paidIn: money(period.flowsCents),
              }),
            }))}
          />
          <dl className="grid grid-cols-3 gap-2 text-sm">
            {/* The colour is the sign's, not the label's: a worst stretch that still gained is
                not a loss, and saying so in red would be a lie the eye reads first. */}
            <div>
              <dt className="text-muted">{t("best")}</dt>
              <dd className={`font-medium ${TONE_TEXT[toneOf(stats.best?.fraction ?? null)]}`}>
                {percent(stats.best?.fraction ?? null)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">{t("worst")}</dt>
              <dd className={`font-medium ${TONE_TEXT[toneOf(stats.worst?.fraction ?? null)]}`}>
                {percent(stats.worst?.fraction ?? null)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">{t("positive")}</dt>
              <dd className="font-medium">
                {t("positiveValue", { positive: stats.positive, counted: stats.counted })}
              </dd>
            </div>
          </dl>
        </>
      )}
    </Card>
  );
}
