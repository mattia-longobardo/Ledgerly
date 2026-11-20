import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { formatDate, formatMoney } from "@ledgerly/domain/platform/format";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { ProgressBar } from "@ledgerly/ui/progress-bar";
import { TONE_TEXT } from "@ledgerly/ui/tone";
import { budgetsView, closestToLimit } from "@ledgerly/domain/budgets";
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
  const top = closestToLimit(view.rows, SHOWN);

  return (
    <Card padded={false} data-testid="budgets-card">
      <CardHeader
        title={t("overview.title", { month: formatDate(month, "month", ctx.locale) })}
        actions={
          <Link
            href="/budgets"
            className="focus-ring inline-flex h-6 items-center rounded-xs text-accent hover:underline"
          >
            {t("overview.viewAll")}
          </Link>
        }
      />
      {top.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted">{t("overview.empty")}</p>
      ) : (
        /*
          One column across the card's whole width: the rows share their tracks (subgrid), so the
          names take the width of the longest one (up to 40 % of the row, so a phone keeps a bar),
          the remainders line up on the right, and every bar fills what is left between them.
        */
        <ul className="grid grid-cols-[fit-content(40%)_minmax(0,1fr)_auto] gap-x-4 gap-y-3 px-4 pb-4">
          {top.map((row) => {
            const left = row.limitCents - row.spentCents;
            return (
              <li key={row.key} className="col-span-3 grid grid-cols-subgrid items-center text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-xs-plus"
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
