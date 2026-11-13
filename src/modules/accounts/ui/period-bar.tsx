import { getTranslations } from "next-intl/server";
import { rangeLabel } from "@/modules/transactions/ui/display";
import { RANGE_PRESETS } from "@/modules/transactions/ui/filters";
import { RangePicker } from "@/modules/transactions/ui/range-picker";
import type { UiLocale } from "@/platform/format";
import type { Params } from "@/ui/url";
import { LinkTabs, PeriodStepper } from "./controls";
import type { PeriodQuery } from "./period";

/**
 * The period control of Expenses (spec §7.2), on Overview, Accounts and Account detail (PERS-342):
 * the stepper with the range as its label — the button that opens the day picker — and the four
 * presets. `carry` is what the page's own links keep; the period is this control's to change.
 */
export async function PeriodBar({
  period,
  path,
  carry = {},
  locale,
}: {
  period: PeriodQuery;
  path: string;
  carry?: Params;
  locale: UiLocale;
}) {
  const t = await getTranslations("expenses.filters");
  /** What a preset or a picked range starts from: the page's parameters and the chart's grain. */
  const kept = { ...carry, ...period.stepperParams, preset: undefined, from: undefined, to: undefined };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <PeriodStepper
        label={t("range.label")}
        path={path}
        params={{ ...carry, ...period.stepperParams }}
        offset={period.offset}
        periodLabel={
          <RangePicker
            range={period.range}
            text={rangeLabel(period.range, locale)}
            params={kept}
            locale={locale}
            label={t("range.label")}
            path={path}
          />
        }
        previousLabel={t("range.previous")}
        nextLabel={t("range.next")}
        latestLabel={t("range.latest")}
      />
      <LinkTabs
        label={t("range.label")}
        path={path}
        params={kept}
        name="preset"
        current={period.preset ?? ""}
        options={RANGE_PRESETS.map((preset) => ({ value: preset, label: t(`presets.${preset}`) }))}
      />
    </div>
  );
}
