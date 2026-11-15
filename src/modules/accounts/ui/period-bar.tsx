import type { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { rangeLabel } from "@/modules/transactions/ui/display";
import { RangePicker } from "@/modules/transactions/ui/range-picker";
import type { UiLocale } from "@/platform/format";
import { type DateRange, RANGE_PRESETS } from "@/platform/ranges";
import type { Params } from "@/ui/url";
import { LinkTabs, PeriodStepper } from "./controls";

/** The words of the control: the server's `getTranslations` or the client's `useTranslations`. */
export type PeriodBarT = ReturnType<typeof useTranslations<"expenses.filters">>;

/** What the control draws of a period: Accounts' `PeriodQuery`, or the one of Funds and Investments. */
export interface PeriodBarPeriod {
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
 * to change. Neither a server nor a client component: a page draws it through `PeriodBar`, a layout
 * — which never sees the search parameters — from a client component of its own.
 */
export function PeriodBarView({
  period,
  path,
  carry = {},
  locale,
  t,
  presets = RANGE_PRESETS,
  name,
  whole,
}: {
  period: PeriodBarPeriod;
  path: string;
  carry?: Params;
  locale: UiLocale;
  t: PeriodBarT;
  /** The presets of the screen, in order: the four of Expenses, and "All" where a P&L is shown. */
  presets?: readonly ("thisMonth" | "lastMonth" | "last3Months" | "ytd" | "all")[];
  /** The period's own name, when it has one the days do not say: a year, as a month has its own. */
  name?: string;
  /** Under a preset with no window: the days it really spans, and the words for them. */
  whole?: { range: DateRange; text: string };
}) {
  /** What a preset or a picked range starts from: the page's parameters and the chart's grain. */
  const kept = { ...carry, ...period.stepperParams, preset: undefined, from: undefined, to: undefined };
  const picker = (range: DateRange, text: string) => (
    <RangePicker
      range={range}
      text={text}
      params={kept}
      locale={locale}
      label={t("range.label")}
      path={path}
    />
  );
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {period.range !== null ? (
        <PeriodStepper
          label={t("range.label")}
          path={path}
          params={{ ...carry, ...period.stepperParams }}
          offset={period.offset}
          periodLabel={
            <span data-testid="period-text">
              {picker(period.range, name ?? rangeLabel(period.range, locale))}
            </span>
          }
          previousLabel={t("range.previous")}
          nextLabel={t("range.next")}
          latestLabel={t("range.latest")}
        />
      ) : (
        whole && (
          <span data-testid="period-text" className="text-sm font-medium">
            {picker(whole.range, whole.text)}
          </span>
        )
      )}
      <LinkTabs
        label={t("range.label")}
        path={path}
        params={kept}
        name="preset"
        current={period.preset ?? ""}
        options={presets.map((preset) => ({ value: preset, label: t(`presets.${preset}`) }))}
      />
    </div>
  );
}

/** The control on a page: the server reads the words. */
export async function PeriodBar(props: Omit<Parameters<typeof PeriodBarView>[0], "t">) {
  const t = await getTranslations("expenses.filters");
  return <PeriodBarView {...props} t={t} />;
}
