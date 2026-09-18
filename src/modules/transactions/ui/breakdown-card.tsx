import { getTranslations } from "next-intl/server";
import { formatMoney, type NumberFormat } from "@/platform/format";
import { Card } from "@/ui/card";
import { CompositionBar } from "@/ui/chart";
import type { BreakdownBar } from "./display";

/**
 * The "By category" card of the design: the composition strip, then one row per category with its
 * own bar, biggest first. The bar measures each category against the largest one, which is what
 * makes the shape of the range readable; the share of the total is on the row's label, because a
 * percentage and an amount side by side is one number too many for a 100 px column.
 */
export async function BreakdownCard({
  bars,
  total,
  numberFormat,
}: {
  bars: readonly BreakdownBar[];
  /**
   * The total of the rows below, already formatted: the design shows it next to the card's title.
   * It is the sum the bars are drawn against, so it says what the rows say (review B2).
   */
  total: string;
  numberFormat: NumberFormat;
}) {
  const t = await getTranslations("expenses.breakdown");

  return (
    <Card className="flex flex-col gap-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        {/* The rows are compared by magnitude, so this is what they *moved*, not a signed
            balance: the design leaves the number bare, which reads as spending and would be a
            second, contradictory total next to the page's own (spec §8.4 point 5). The label is
            what makes it honest without changing the shape. */}
        <span className="text-sm text-muted tabular-nums" title={t("total", { total })}>
          <span className="sr-only">{t("total", { total })}</span>
          <span aria-hidden>{total}</span>
        </span>
      </div>

      {bars.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <>
          <CompositionBar
            parts={bars.map((bar) => ({ label: bar.name, share: bar.share, color: bar.color }))}
          />
          <ul className="flex flex-col gap-2.5">
            {bars.map((bar) => (
              <li
                key={bar.id}
                className="grid grid-cols-[minmax(0,100px)_minmax(0,1fr)_80px] items-center gap-2.5 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-[2px]"
                    style={{ background: bar.color }}
                  />
                  <span className="min-w-0 truncate font-medium">{bar.name}</span>
                </span>
                <span
                  className="h-1 rounded-full bg-track"
                  aria-label={t("share", { share: Math.round(bar.share * 100) })}
                >
                  <span
                    className="block h-full rounded-full opacity-80"
                    style={{ width: `${(bar.width * 100).toFixed(1)}%`, background: bar.color }}
                  />
                </span>
                <span className="text-right tabular-nums">{formatMoney(bar.cents, numberFormat)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
