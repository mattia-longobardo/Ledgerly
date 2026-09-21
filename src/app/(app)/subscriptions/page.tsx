import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LinkTabs } from "@/modules/accounts/ui/controls";
import { subscriptionsView, suggestions } from "@/modules/subscriptions/queries";
import { newDraft, presentRow, presentSuggestion, toleranceInput } from "@/modules/subscriptions/ui/present";
import { AddSubscription, type DialogOptions } from "@/modules/subscriptions/ui/subscription-dialog";
import { InactiveSubscriptions, SubscriptionsTable } from "@/modules/subscriptions/ui/subscriptions-table";
import { SuggestionsButton } from "@/modules/subscriptions/ui/suggestions-dialog";
import { categoryOptions } from "@/modules/transactions/taxonomy";
import { requireSession } from "@/platform/auth/session";
import { today } from "@/platform/dates";
import { formatDate, formatMoney } from "@/platform/format";
import { buttonClassName } from "@/ui/button";
import { Card, CardHeader } from "@/ui/card";
import { cn } from "@/ui/cn";
import { KpiTile } from "@/ui/kpi-tile";
import { ProgressBar } from "@/ui/progress-bar";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("subscriptions"))("title") };
}

const DEFAULT_TOLERANCE = "0.05";

/** Subscriptions (spec §7.5): the table, the payment check, the projection per account. */
export default async function SubscriptionsPage({ searchParams }: PageProps<"/subscriptions">) {
  const ctx = await requireSession();
  const t = await getTranslations("subscriptions");
  const query = await searchParams;
  const horizon = query.proj === "year" ? "year" : "month";
  const todayOn = today(ctx.timeZone);
  const format = { numberFormat: ctx.numberFormat, locale: ctx.locale };
  const [view, suggested, categories] = await Promise.all([
    subscriptionsView(ctx),
    suggestions(ctx),
    categoryOptions(ctx, "expense"),
  ]);
  const money = (cents: bigint | null) => formatMoney(cents, ctx.numberFormat);
  const options: DialogOptions = { categories, accounts: view.accounts };
  const defaultTolerance = toleranceInput(DEFAULT_TOLERANCE, ctx.numberFormat);
  const empty = newDraft(todayOn, defaultTolerance);
  const rows = view.rows.map((row) => presentRow(row, t, format));
  const inactive = view.inactive.map((row) => presentRow(row, t, format));

  const suggest = (
    <SuggestionsButton
      suggestions={suggested.map((one) => presentSuggestion(one, t, format, defaultTolerance))}
      options={options}
    />
  );
  // Below 768 px the top bar has room for the primary action only; the suggestions move into the
  // page and the export, a desk task, stays on the larger screens.
  const actions = (
    <>
      <span className="contents max-md:hidden">
        <a href="/subscriptions/export.csv" download className={buttonClassName("ghost", "sm")}>
          {t("export")}
        </a>
        {suggest}
      </span>
      <AddSubscription draft={empty} options={options} label={t("add")} />
    </>
  );

  if (rows.length === 0 && inactive.length === 0) {
    return (
      <Page title={t("title")} actions={actions}>
        <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
        <EmptyState
          title={t("empty.title")}
          description={t("empty.description")}
          actions={<AddSubscription draft={empty} options={options} label={t("empty.cta")} size="md" />}
        />
        <div className="md:hidden">{suggest}</div>
      </Page>
    );
  }

  const projections = view.projections[horizon];
  const largest = view.byCategory.reduce(
    (top, entry) => (entry.yearlyCents > top ? entry.yearlyCents : top),
    0n,
  );

  return (
    <Page title={t("title")} actions={actions}>
      {view.alerts.length > 0 && (
        <section aria-label={t("alerts.label")} className="flex flex-col gap-2">
          {view.alerts.map((alert) => {
            const tone = alert.charge.state === "not_found" ? "neg" : "warn";
            const price = money(alert.charge.expectedCents);
            const account = alert.accountName ?? t("anyAccount");
            const text =
              alert.charge.state === "not_found"
                ? t("alerts.not_found", {
                    match: alert.payeeMatch ?? "",
                    account,
                    period: formatDate(alert.charge.dueOn, "monthYear", ctx.locale),
                    price,
                  })
                : alert.charge.state === "amount_differs"
                  ? t("alerts.amount_differs", {
                      actual: money(alert.charge.actualCents),
                      date: formatDate(alert.charge.dueOn, "long", ctx.locale),
                      expected: price,
                    })
                  : t("alerts.due", {
                      date: formatDate(alert.charge.dueOn, "long", ctx.locale),
                      price,
                      account,
                    });
            return (
              <div
                key={alert.charge.id}
                data-testid="subscription-alert"
                className={cn(
                  "flex flex-wrap items-center justify-between gap-2 rounded-card border px-3 py-2 text-sm",
                  tone === "neg" ? "border-neg/30 bg-neg-bg" : "border-warn/30 bg-warn-bg",
                )}
              >
                <p>
                  <strong className="font-semibold">{alert.name}</strong> — {text}
                </p>
                <Link
                  href="/expenses"
                  className="focus-ring shrink-0 rounded-[2px] font-medium text-accent hover:underline"
                >
                  {t("alerts.checkExpenses")}
                </Link>
              </div>
            );
          })}
        </section>
      )}

      <div className="flex flex-col gap-0.5">
        <h1 className="text-title font-semibold tracking-[-0.02em] max-md:sr-only">{t("title")}</h1>
        <p className="text-muted tabular-nums">
          {t("subtitle", { count: rows.length, monthly: money(view.monthlyCents) })}
        </p>
        <div className="mt-2 md:hidden">{suggest}</div>
      </div>

      <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
        <KpiTile label={t("kpis.monthly")} value={money(view.monthlyCents)} note={t("kpis.monthlyNote")} />
        <KpiTile label={t("kpis.yearly")} value={money(view.yearlyCents)} note={t("kpis.yearlyNote")} />
        <KpiTile
          label={t("kpis.low")}
          value={money(view.lowUtilityYearlyCents)}
          valueTone={view.lowUtilityCount > 0 ? "warn" : "fg"}
          note={t("kpis.lowNote", { count: view.lowUtilityCount })}
        />
        <KpiTile
          label={t("kpis.next30")}
          value={money(view.next30Cents)}
          note={t("kpis.next30Note", { date: formatDate(view.next30Until, "dayMonth", ctx.locale) })}
        />
      </div>

      <div className="grid items-start gap-4 @wide:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <Card padded={false}>
            <SubscriptionsTable
              rows={rows}
              options={options}
              totals={{
                count: t("totalCount", { count: rows.length }),
                monthly: money(view.monthlyCents),
                yearly: money(view.yearlyCents),
              }}
            />
          </Card>
          {inactive.length > 0 && (
            <InactiveSubscriptions
              rows={inactive}
              options={options}
              title={t("inactive.title", { count: inactive.length })}
            />
          )}
        </div>

        {/* Beside the table only past the wide threshold; below it they share a row under it. */}
        <div className="grid min-w-0 items-start gap-4 @4xl:grid-cols-2 @wide:grid-cols-1">
          <Card className="flex flex-col gap-3" data-testid="projection">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{t("projection.title")}</h2>
              <LinkTabs
                label={t("projection.title")}
                path="/subscriptions"
                params={{}}
                name="proj"
                current={horizon}
                options={[
                  { value: "month", label: t("projection.month") },
                  { value: "year", label: t("projection.year") },
                ]}
              />
            </div>
            <p className="text-sm text-muted">
              {horizon === "year" ? t("projection.yearText") : t("projection.monthText")}
            </p>
            {projections.length === 0 && <p className="text-sm text-muted">{t("projection.empty")}</p>}
            {projections.map((projection) => {
              const share =
                projection.balanceCents !== null && projection.balanceCents > 0n
                  ? Number((projection.commitCents * 1000n) / projection.balanceCents) / 1000
                  : null;
              return (
                <div
                  key={projection.accountId ?? "none"}
                  className="flex flex-col gap-2 border-t border-border pt-3"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium">
                      {projection.accountName ?? t("projection.noAccount")}
                    </span>
                    <span className="text-sm text-muted">
                      {t("projection.count", { count: projection.count })}
                    </span>
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-sm tabular-nums">
                    <div>
                      <dt className="text-muted">{t("projection.balance")}</dt>
                      <dd>{money(projection.balanceCents)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">{t("projection.commit")}</dt>
                      <dd className="text-neg">{money(-projection.commitCents)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">{t("projection.projected")}</dt>
                      <dd
                        className={cn(
                          "font-semibold",
                          projection.projectedCents !== null && projection.projectedCents < 0n && "text-neg",
                        )}
                      >
                        {money(projection.projectedCents)}
                      </dd>
                    </div>
                  </dl>
                  {share !== null && (
                    <ProgressBar
                      value={share}
                      tone={share > 0.5 ? "warn" : "accent"}
                      label={t("projection.share")}
                    />
                  )}
                </div>
              );
            })}
          </Card>

          <Card padded={false}>
            <CardHeader title={t("byCategory.title")} />
            <ul className="flex flex-col gap-2 px-4 pb-4">
              {view.byCategory.map((entry) => (
                <li
                  key={entry.groupId ?? "none"}
                  className="grid grid-cols-[90px_1fr_84px] items-center gap-2 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      aria-hidden
                      className="inline-block size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: entry.color ?? undefined }}
                    />
                    <span className="truncate">{entry.name ?? t("byCategory.uncategorised")}</span>
                  </span>
                  <ProgressBar
                    value={largest === 0n ? 0 : Number((entry.yearlyCents * 1000n) / largest) / 1000}
                    label={entry.name ?? t("byCategory.uncategorised")}
                    color={entry.color ?? undefined}
                  />
                  <span className="text-right tabular-nums">{money(entry.yearlyCents)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </Page>
  );
}
