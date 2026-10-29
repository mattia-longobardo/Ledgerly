import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { type PeriodQuery, yearsOf } from "@/modules/investments/period";
import type { PnlPeriod } from "@/modules/investments/pnl";
import { addDays, type CivilDate } from "@/platform/dates";
import { formatDate, type UiLocale } from "@/platform/format";
import { cn } from "@/ui/cn";
import { type Params, withParams } from "@/ui/url";
import { PeriodPicker } from "./period-picker";

type T = Awaited<ReturnType<typeof getTranslations<"investments.period">>>;

/** The period in words (§2.1): "2026 · year to date", "2025", "since 28 Oct 2024", or the days. */
export function periodText(
  period: PnlPeriod,
  span: { from: CivilDate; to: CivilDate },
  todayOn: CivilDate,
  locale: UiLocale,
  t: T,
): string {
  if (period.kind === "year") {
    return period.year === Number(todayOn.slice(0, 4))
      ? t("yearToDate", { year: period.year })
      : String(period.year);
  }
  if (period.kind === "all") return t("since", { date: formatDate(span.from, "long", locale) });
  return t("range", { from: formatDate(span.from, "long", locale), to: formatDate(span.to, "long", locale) });
}

/**
 * The period of the section (docs/design/investments-ux.md §2.1, §9 decision 1): `Year · All ·
 * Custom` as links, and beside it the stepper ‹ 2026 › for a year, the first day for All, or the
 * day range picker for Custom. Everything is an address: the server draws it, the back button
 * walks it, and `params` (the chart's view, the composition's grouping) rides along.
 */
export async function PeriodControl({
  period,
  span,
  todayOn,
  firstOn,
  path,
  params,
  locale,
}: {
  period: PnlPeriod;
  span: { from: CivilDate; to: CivilDate };
  todayOn: CivilDate;
  firstOn: CivilDate | null;
  path: string;
  /** Every parameter but the period's. */
  params: Params;
  locale: UiLocale;
}) {
  const t = await getTranslations("investments.period");
  const years = yearsOf(firstOn, todayOn);
  const href = (query: PeriodQuery) => withParams(path, params, query);
  const yearHref = (year: number) => href(year === years.last ? {} : { period: String(year) });
  const custom = { from: span.from, to: span.to };
  const kinds = [
    { kind: "year", label: t("kinds.year"), href: href({}) },
    { kind: "all", label: t("kinds.all"), href: href({ period: "all" }) },
    { kind: "custom", label: t("kinds.custom"), href: href(custom) },
  ] as const;
  const text = periodText(period, span, todayOn, locale, t);
  const arrow = "focus-ring grid size-7 place-items-center rounded-ctl border border-border bg-card";

  const shortcuts: { label: string; query: PeriodQuery }[] = [
    { label: t("yearToDate", { year: years.last }), query: {} },
    ...[years.last - 1, years.last - 2]
      .filter((year) => year >= years.first)
      .map((year) => ({ label: String(year), query: { period: String(year) } })),
    { label: t("last12"), query: { from: addDays(todayOn, -364), to: todayOn } },
    { label: t("kinds.all"), query: { period: "all" } },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label={t("label")} className="inline-flex gap-0.5 rounded-[7px] bg-hover p-0.5">
        {kinds.map((one) => (
          <Link
            key={one.kind}
            href={one.href}
            aria-current={period.kind === one.kind ? "true" : undefined}
            className={cn(
              "focus-ring inline-flex h-6 items-center rounded-[5px] px-2.5 text-sm font-medium",
              period.kind === one.kind
                ? "bg-card text-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                : "text-muted hover:text-fg",
            )}
          >
            {one.label}
          </Link>
        ))}
      </div>
      {period.kind === "year" && (
        <div role="group" aria-label={t("stepper")} className="inline-flex items-center gap-2">
          {period.year! > years.first ? (
            <Link
              href={yearHref(period.year! - 1)}
              aria-label={t("previous")}
              className={cn(arrow, "hover:bg-hover")}
            >
              <ChevronLeft aria-hidden className="size-3.5" />
            </Link>
          ) : (
            <button type="button" disabled aria-label={t("previous")} className={cn(arrow, "text-faint")}>
              <ChevronLeft aria-hidden className="size-3.5" />
            </button>
          )}
          <span data-testid="period-text" className="min-w-[150px] text-center text-sm font-medium">
            {text}
          </span>
          {period.year! < years.last ? (
            <Link
              href={yearHref(period.year! + 1)}
              aria-label={t("next")}
              className={cn(arrow, "hover:bg-hover")}
            >
              <ChevronRight aria-hidden className="size-3.5" />
            </Link>
          ) : (
            <button type="button" disabled aria-label={t("next")} className={cn(arrow, "text-faint")}>
              <ChevronRight aria-hidden className="size-3.5" />
            </button>
          )}
        </div>
      )}
      {period.kind === "all" && (
        <span data-testid="period-text" className="text-sm font-medium text-muted">
          {text}
        </span>
      )}
      {period.kind === "custom" && (
        <PeriodPicker
          range={custom}
          text={text}
          path={path}
          params={params}
          locale={locale}
          shortcuts={shortcuts.map((one) => ({ label: one.label, href: href(one.query) }))}
        />
      )}
    </div>
  );
}
