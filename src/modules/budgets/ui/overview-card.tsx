import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Ctx } from "@/platform/context";
import { formatDate, formatMoney } from "@/platform/format";
import { Card, CardHeader } from "@/ui/card";
import { ProgressBar } from "@/ui/progress-bar";
import { TONE_TEXT } from "@/ui/tone";
import { budgetsView } from "../queries";
import { budgetName, NO_COLOR } from "./present";

const SHOWN = 5;
const BAR_TONE = { over: "neg", near: "warn", on_track: "accent" } as const;
const TEXT_TONE = { over: "neg", near: "warn", on_track: "muted" } as const;

/** Overview's "Budgets · <month>" card (design): the five budgets closest to their limit. */
export async function BudgetsOverviewCard({
  ctx,
  month,
}: {
  ctx: Pick<Ctx, "userId" | "timeZone" | "locale" | "numberFormat">;
  month: string;
}) {
  const t = await getTranslations("budgets");
  const view = await budgetsView(ctx, month);
  const top = [...view.rows]
    .sort((a, b) => b.percent - a.percent || a.key.localeCompare(b.key))
    .slice(0, SHOWN);

  return (
    <Card padded={false} data-testid="budgets-card">
      <CardHeader
        title={t("overview.title", { month: formatDate(month, "month", ctx.locale) })}
        actions={
          <Link href="/budgets" className="focus-ring rounded-[2px] text-accent hover:underline">
            {t("overview.viewAll")}
          </Link>
        }
      />
      {top.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted">{t("overview.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3 px-4 pb-4">
          {top.map((row) => {
            const left = row.limitCents - row.spentCents;
            return (
              <li
                key={row.key}
                className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-[3px]"
                    style={{ background: row.color ?? NO_COLOR }}
                  />
                  <span className="truncate">
                    {budgetName(row, t("allCategories"))}
                    {row.accountName && <span className="text-muted"> · {row.accountName}</span>}
                  </span>
                </span>
                <ProgressBar
                  value={row.percent / 100}
                  tone={BAR_TONE[row.status]}
                  label={budgetName(row, t("allCategories"))}
                />
                <span className={`tabular-nums ${TONE_TEXT[TEXT_TONE[row.status]]}`}>
                  {left < 0n
                    ? t("overview.over", { amount: formatMoney(-left, ctx.numberFormat) })
                    : t("overview.remaining", { amount: formatMoney(left, ctx.numberFormat) })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
