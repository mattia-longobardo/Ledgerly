"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { budgets } from "@ledgerly/api-contract/budgets";
import type { RouteOutput } from "@ledgerly/api-client";
import { parseCents } from "@ledgerly/format/cents";
import { formatDate, formatMoney, type NumberFormat, type UiLocale } from "@ledgerly/format/format";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { ProgressBar } from "@ledgerly/ui/progress-bar";
import { TONE_TEXT } from "@ledgerly/ui/tone";
import { NO_COLOR } from "./colors";

const BAR_TONE = { over: "neg", near: "warn", on_track: "accent" } as const;
const TEXT_TONE = { over: "neg", near: "warn", on_track: "muted" } as const;

type Line = RouteOutput<typeof budgets.getBudgetsOverview>["budgets"][number];
interface CardFormat {
  locale: UiLocale;
  numberFormat: NumberFormat;
}

function OverviewRow({ line, format }: { line: Line; format: CardFormat }) {
  const text = useTranslations("budgets");
  const name = line.name ?? text("allCategories");
  const left = parseCents(line.remaining);
  return (
    <li className="col-span-3 grid grid-cols-subgrid items-center text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-xs-plus"
          style={{ background: line.color ?? NO_COLOR }}
        />
        <span className="truncate">
          {name}
          {line.account && <span className="text-muted"> · {line.account}</span>}
        </span>
      </span>
      <ProgressBar value={line.percent / 100} tone={BAR_TONE[line.status]} label={name} />
      <span className={`tabular-nums ${TONE_TEXT[TEXT_TONE[line.status]]}`}>
        {left < 0n
          ? text("overview.over", { amount: formatMoney(-left, format.numberFormat) })
          : text("overview.remaining", { amount: formatMoney(left, format.numberFormat) })}
      </span>
    </li>
  );
}

/** Overview's "Budgets · <month>" card (design): the budgets closest to their limit, as the API sorts them. */
export function BudgetsOverviewCard({ format }: { format: CardFormat }) {
  const text = useTranslations("budgets");
  const read = useApi(budgets.getBudgetsOverview, {});
  return (
    <Loaded state={read}>
      {(view) => (
        <Card padded={false} data-testid="budgets-card">
          <CardHeader
            title={text("overview.title", { month: formatDate(view.month, "month", format.locale) })}
            actions={
              <Link
                href="/budgets"
                className="focus-ring inline-flex h-6 items-center rounded-xs text-accent hover:underline"
              >
                {text("overview.viewAll")}
              </Link>
            }
          />
          {view.budgets.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted">{text("overview.empty")}</p>
          ) : (
            /*
              One column across the card's whole width: the rows share their tracks (subgrid), so the
              names take the width of the longest one (up to 40 % of the row, so a phone keeps a bar),
              the remainders line up on the right, and every bar fills what is left between them.
            */
            <ul className="grid grid-cols-[fit-content(40%)_minmax(0,1fr)_auto] gap-x-4 gap-y-3 px-4 pb-4">
              {view.budgets.map((line) => (
                <OverviewRow key={line.slug} line={line} format={format} />
              ))}
            </ul>
          )}
        </Card>
      )}
    </Loaded>
  );
}
