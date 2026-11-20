"use client";

import { useTranslations } from "use-intl";
import type { UiLocale } from "@ledgerly/format/format";
import { type DateRange, RANGE_PRESETS, rangeLabel } from "@ledgerly/format/ranges";
import { LinkTabs, PeriodStepper } from "./link-controls";
import { RangePicker } from "./range-picker";
import type { Params } from "./url";

/** What the control draws of a period: Accounts' `PeriodQuery`, or the one of Funds and Investments. */
interface PeriodBarPeriod {
  preset: string | null;
  offset: number;
  /** `null` for a preset with no window of its own ("All"): the control then shows `whole`. */
  range: DateRange | null;
  stepperParams: Params;
}

/**
 * The period control of Expenses (spec §7.2), on Overview, Accounts, Account detail (PERS-342),
 * Funds and Investments: the stepper with the range as its label — the button that opens the day
 * picker — and the presets. `carry` is what the page's own links keep; the period is this control's
 * to change. One control for every screen (audit UI-ACC-4); it reads its own words.
 */
export function PeriodBar({
  period,
  path,
  carry = {},
  locale,
  presets = RANGE_PRESETS,
  name,
  whole,
}: {
  period: PeriodBarPeriod;
  path: string;
  carry?: Params;
  locale: UiLocale;
  /** The presets of the screen, in order: the four of Expenses, and "All" where a P&L is shown. */
  presets?: readonly ("thisMonth" | "lastMonth" | "last3Months" | "ytd" | "all")[];
  /** The period's own name, when it has one the days do not say: a year, as a month has its own. */
  name?: string;
  /** Under a preset with no window: the days it really spans, and the words for them. */
  whole?: { range: DateRange; text: string };
}) {
  const words = useTranslations("common.period");
  /** What a preset or a picked range starts from: the page's parameters and the chart's grain. */
  const kept = { ...carry, ...period.stepperParams, preset: undefined, from: undefined, to: undefined };
  const picker = (range: DateRange, rangeText: string) => (
    <RangePicker
      range={range}
      text={rangeText}
      params={kept}
      locale={locale}
      label={words("label")}
      path={path}
    />
  );
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {period.range !== null ? (
        <PeriodStepper
          label={words("label")}
          path={path}
          params={{ ...carry, ...period.stepperParams }}
          offset={period.offset}
          periodLabel={
            <span data-testid="period-text">
              {picker(period.range, name ?? rangeLabel(period.range, locale))}
            </span>
          }
          previousLabel={words("previous")}
          nextLabel={words("next")}
          latestLabel={words("latest")}
        />
      ) : (
        whole && (
          <span data-testid="period-text" className="text-sm font-medium">
            {picker(whole.range, whole.text)}
          </span>
        )
      )}
      <LinkTabs
        label={words("label")}
        path={path}
        params={kept}
        name="preset"
        current={period.preset ?? ""}
        options={presets.map((preset) => ({ value: preset, label: words(`presets.${preset}`) }))}
      />
    </div>
  );
}
