import { ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { formatMoney, type NumberFormat } from "@/platform/format";
import { Card } from "@/ui/card";
import { CompositionBar } from "@/ui/chart";
import type { BreakdownBar, BreakdownGroup } from "./display";

const ROW = "grid grid-cols-[minmax(0,100px)_minmax(0,1fr)_80px] items-center gap-2.5 text-sm";

/** One row of the card: the swatch and name, the bar against the largest sibling, the amount. */
function Row({
  bar,
  numberFormat,
  shareLabel,
  child = false,
  expandable = false,
}: {
  bar: BreakdownBar;
  numberFormat: NumberFormat;
  shareLabel: string;
  child?: boolean;
  /** A group with sub-categories: the arrow turns when its `<details>` is open. */
  expandable?: boolean;
}) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-2">
        {expandable && (
          <ChevronRight
            aria-hidden
            className="-ml-1 size-3 shrink-0 text-muted transition-transform group-open/breakdown:rotate-90"
          />
        )}
        <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: bar.color }} />
        <span className={child ? "min-w-0 truncate text-muted" : "min-w-0 truncate font-medium"}>
          {bar.name}
        </span>
      </span>
      <span className="h-1 rounded-full bg-track" aria-label={shareLabel}>
        <span
          className="block h-full rounded-full opacity-80"
          style={{ width: `${(bar.width * 100).toFixed(1)}%`, background: bar.color }}
        />
      </span>
      <span className="text-right tabular-nums">{formatMoney(bar.cents, numberFormat)}</span>
    </>
  );
}

/**
 * The "By category" card of the design: the composition strip, then one row per group with its own
 * bar, biggest first. The bar measures each group against the largest one, which is what makes the
 * shape of the range readable; the share of the total is on the row's label, because a percentage
 * and an amount side by side is one number too many for a 100 px column.
 *
 * A group with sub-categories (F2.5) is a `<details>`: it opens without JavaScript, and inside it
 * the sub-categories are measured against each other, so their shares are of the group.
 */
export async function BreakdownCard({
  groups,
  total,
  numberFormat,
}: {
  groups: readonly BreakdownGroup[];
  /**
   * The total of the rows below, already formatted: the design shows it next to the card's title.
   * It is the sum the bars are drawn against, so it says what the rows say (review B2).
   */
  total: string;
  numberFormat: NumberFormat;
}) {
  const t = await getTranslations("expenses.breakdown");
  const share = (bar: BreakdownBar) => t("share", { share: Math.round(bar.share * 100) });

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

      {groups.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <>
          <CompositionBar
            parts={groups.map((group) => ({ label: group.name, share: group.share, color: group.color }))}
          />
          <ul className="flex flex-col gap-2.5">
            {groups.map((group) =>
              group.children.length === 0 ? (
                <li key={group.id} className={ROW}>
                  <Row bar={group} numberFormat={numberFormat} shareLabel={share(group)} />
                </li>
              ) : (
                <li key={group.id}>
                  <details className="group/breakdown">
                    <summary
                      className={`${ROW} focus-ring -mx-1 cursor-pointer list-none rounded-[4px] px-1 hover:bg-hover [&::-webkit-details-marker]:hidden`}
                      title={t("expand", { name: group.name })}
                    >
                      <Row bar={group} numberFormat={numberFormat} shareLabel={share(group)} expandable />
                    </summary>
                    <ul className="mt-2 flex flex-col gap-2 border-l border-border pl-3">
                      {group.children.map((child) => (
                        <li key={child.id} className={ROW}>
                          <Row bar={child} numberFormat={numberFormat} shareLabel={share(child)} child />
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ),
            )}
          </ul>
        </>
      )}
    </Card>
  );
}
