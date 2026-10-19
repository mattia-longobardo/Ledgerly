import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { budgetDetail } from "@/modules/budgets/queries";
import { ALERT_PRESETS, parseBudgetSlug, percentOf } from "@/modules/budgets/rules";
import { AlertsForm } from "@/modules/budgets/ui/alerts-form";
import { budgetName, NO_COLOR } from "@/modules/budgets/ui/present";
import { getAuth } from "@/platform/auth/auth";
import { requireSession } from "@/platform/auth/session";
import { monthKey, today } from "@/platform/dates";
import { formatDate, formatMoney, formatWholePercent, NULL_DISPLAY } from "@/platform/format";
import { Badge } from "@/ui/badge";
import { Card, CardHeader } from "@/ui/card";
import { cn } from "@/ui/cn";
import { ProgressBar } from "@/ui/progress-bar";
import { Page } from "@/ui/shell/page";
import { TONE_TEXT } from "@/ui/tone";

const BAR_TONE = { over: "neg", near: "warn", on_track: "accent" } as const;
const BADGE_TONE = { over: "neg", near: "warn", on_track: "pos" } as const;

async function load(id: string) {
  const ctx = await requireSession();
  const scope = parseBudgetSlug(id);
  if (!scope) notFound();
  const month = monthKey(today(ctx.timeZone));
  const detail = await budgetDetail(ctx, scope, month);
  if (!detail) notFound();
  const t = await getTranslations("budgets");
  return { ctx, scope, month, detail, t, name: budgetName(detail.row, t("allCategories")) };
}

export async function generateMetadata({ params }: PageProps<"/budgets/[id]">): Promise<Metadata> {
  const { name } = await load((await params).id);
  return { title: name };
}

/**
 * One budget (spec §7.3): where this month stands, the months before it, and when it emails —
 * the thresholds the `budgets-alerts` job checks every hour.
 */
export default async function BudgetPage({ params }: PageProps<"/budgets/[id]">) {
  const { ctx, scope, month, detail, t, name } = await load((await params).id);
  const session = await (await getAuth()).api.getSession({ headers: await headers() });
  const { row } = detail;
  const money = (cents: bigint, decimals = true) => formatMoney(cents, ctx.numberFormat, { decimals });
  const percent = (value: number) => formatWholePercent(value, ctx.numberFormat);
  const over = row.spentCents > row.limitCents;
  const account = row.accountName ? t("detail.onAccount", { account: row.accountName }) : t("allAccounts");
  const percentLabels = Object.fromEntries(
    [...new Set([...ALERT_PRESETS, ...detail.alerts.thresholds])].map((value) => [value, percent(value)]),
  );

  return (
    <Page title={name} parent={{ href: "/budgets", label: t("title") }}>
      <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{name}</h1>

      <Card className="flex flex-col gap-4" data-testid="budget-detail">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="flex items-center gap-2 text-sm text-muted">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{ background: row.color ?? NO_COLOR }}
              />
              <span className="truncate">
                {account} · {t("detail.thisMonth", { month: formatDate(month, "monthYear", ctx.locale) })}
              </span>
            </p>
            <p className="text-hero font-semibold tracking-[-0.02em] tabular-nums">{money(row.spentCents)}</p>
            <p className="text-sm text-muted">{t("detail.progress", { percent: percent(row.percent) })}</p>
          </div>
          <Badge tone={BADGE_TONE[row.status]}>{t(`status.${row.status}`)}</Badge>
        </div>
        <ProgressBar
          value={row.percent / 100}
          tone={BAR_TONE[row.status]}
          label={t("progressOf", { category: name, percent: percent(row.percent) })}
        />
        <dl className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-0.5">
            <dt className="text-sm text-muted">{t("detail.spent")}</dt>
            <dd className="font-semibold tabular-nums">{money(row.spentCents)}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-sm text-muted">{t("detail.limit")}</dt>
            <dd className="font-semibold tabular-nums">{money(row.limitCents)}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-sm text-muted">{over ? t("detail.over") : t("detail.remaining")}</dt>
            <dd className={cn("font-semibold tabular-nums", over && TONE_TEXT.neg)}>
              {money(over ? row.spentCents - row.limitCents : row.limitCents - row.spentCents)}
            </dd>
          </div>
        </dl>
      </Card>

      <div className="grid items-start gap-4 @4xl:grid-cols-2">
        <Card className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">{t("alerts.title")}</h2>
            <p className="text-sm text-muted">
              {t("alerts.description", { email: session?.user.email ?? NULL_DISPLAY })}
            </p>
          </div>
          <AlertsForm scope={scope} initial={detail.alerts} percentLabels={percentLabels} />
        </Card>

        <Card padded={false} className="min-w-0" data-testid="budget-history">
          <CardHeader title={t("detail.history")} />
          <ul className="flex flex-col divide-y divide-border px-4 pb-2">
            {detail.history.map((past) => {
              const label = formatDate(past.month, "monthYear", ctx.locale);
              const share = past.limitCents === null ? null : percentOf(past.spentCents, past.limitCents);
              const pastOver = past.limitCents !== null && past.spentCents > past.limitCents;
              return (
                <li key={past.month} className="flex flex-col gap-1.5 py-2.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium capitalize">{label}</span>
                    <span className={cn("tabular-nums", pastOver ? TONE_TEXT.neg : "text-muted")}>
                      {past.limitCents === null
                        ? `${money(past.spentCents)} · ${t("detail.noLimit")}`
                        : `${money(past.spentCents)} / ${money(past.limitCents, past.limitCents % 100n !== 0n)}`}
                    </span>
                  </div>
                  {share !== null && (
                    <ProgressBar
                      value={share / 100}
                      tone={pastOver ? "neg" : "accent"}
                      label={t("detail.historyRow", {
                        month: label,
                        spent: money(past.spentCents),
                        limit: money(past.limitCents!),
                      })}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </Page>
  );
}
