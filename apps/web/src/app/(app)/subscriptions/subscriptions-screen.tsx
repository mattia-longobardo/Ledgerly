"use client";

// Subscriptions (spec §7.5), read from `/api/v1` (rewrite plan R3): the table, the payment check and
// the projection per account. Every figure is a field of `GET /subscriptions`; the screen formats it.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { profile } from "@ledgerly/api-contract/settings";
import { subscriptions as subscriptionRoutes } from "@ledgerly/api-contract/subscriptions";
import type { RouteOutput } from "@ledgerly/api-client";
import { parseCents } from "@ledgerly/format/cents";
import { today } from "@ledgerly/format/dates";
import { formatDate, formatMoney, numberStyle } from "@ledgerly/format/format";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { useApi } from "@ledgerly/ui/data";
import { KpiTile } from "@ledgerly/ui/kpi-tile";
import { LinkTabs } from "@ledgerly/ui/link-controls";
import { Loaded } from "@ledgerly/ui/loaded";
import { ProgressBar } from "@ledgerly/ui/progress-bar";
import { Page } from "@ledgerly/ui/shell/page";
import { EmptyState } from "@ledgerly/ui/states";
import {
  AddSubscription,
  type DialogOptions,
  ExportLink,
  type Format,
  InactiveSubscriptions,
  newDraft,
  presentRow,
  presentSuggestion,
  SubscriptionsTable,
  SuggestionsButton,
} from "@/modules/subscriptions/client";
import { useCategoryOptions } from "@/platform/category-options";

type View = RouteOutput<typeof subscriptionRoutes.listSubscriptions>;

interface Context extends Format {
  today: string;
  options: DialogOptions;
  /** An amount of the wire, formatted; null stays the empty mark. */
  money: (amount: string | null) => string;
}

interface Props {
  view: View;
  context: Context;
}

function Alerts({ view, context }: Props) {
  const text = useTranslations("subscriptions");
  const { money } = context;
  if (view.alerts.length === 0) return null;
  return (
    <section aria-label={text("alerts.label")} className="flex flex-col gap-2">
      {view.alerts.map((alert) => {
        const { charge } = alert;
        const price = money(charge.expected);
        const account = alert.account ?? text("anyAccount");
        const long = formatDate(charge.dueOn, "long", context.locale);
        const line =
          charge.state === "not_found"
            ? text("alerts.not_found", {
                match: alert.payeeMatch ?? "",
                account,
                period: formatDate(charge.dueOn, "monthYear", context.locale),
                price,
              })
            : charge.state === "amount_differs"
              ? text("alerts.amount_differs", { actual: money(charge.actual), date: long, expected: price })
              : text("alerts.due", { date: long, price, account });
        return (
          <div
            key={charge.id}
            data-testid="subscription-alert"
            className={cn(
              "flex flex-wrap items-center justify-between gap-2 rounded-card border px-3 py-2 text-sm",
              charge.state === "not_found" ? "border-neg/30 bg-neg-bg" : "border-warn/30 bg-warn-bg",
            )}
          >
            <p>
              <strong className="font-semibold">{alert.name}</strong> — {line}
            </p>
            <Link
              href="/expenses"
              className="focus-ring inline-flex min-h-6 shrink-0 items-center rounded-xs font-medium text-accent hover:underline"
            >
              {text("alerts.checkExpenses")}
            </Link>
          </div>
        );
      })}
    </section>
  );
}

function Kpis({ view, context }: Props) {
  const text = useTranslations("subscriptions");
  const { money } = context;
  const { totals } = view;
  return (
    <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
      <KpiTile label={text("kpis.monthly")} value={money(totals.monthly)} note={text("kpis.monthlyNote")} />
      <KpiTile label={text("kpis.yearly")} value={money(totals.yearly)} note={text("kpis.yearlyNote")} />
      <KpiTile
        label={text("kpis.low")}
        value={money(totals.lowUtility.yearly)}
        valueTone={totals.lowUtility.count > 0 ? "warn" : "fg"}
        note={text("kpis.lowNote", { count: totals.lowUtility.count })}
      />
      <KpiTile
        label={text("kpis.next30")}
        value={money(totals.next30.amount)}
        note={text("kpis.next30Note", { date: formatDate(totals.next30.until, "dayMonth", context.locale) })}
      />
    </div>
  );
}

function ProjectionRow({
  projection,
  context,
}: {
  projection: View["projections"]["month"][number];
  context: Context;
}) {
  const text = useTranslations("subscriptions");
  const { money } = context;
  const projected = projection.projected === null ? null : parseCents(projection.projected);
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium">{projection.account ?? text("projection.noAccount")}</span>
        <span className="text-sm text-muted">{text("projection.count", { count: projection.count })}</span>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-sm tabular-nums">
        <div>
          <dt className="text-muted">{text("projection.balance")}</dt>
          <dd>{money(projection.balance)}</dd>
        </div>
        <div>
          <dt className="text-muted">{text("projection.commit")}</dt>
          <dd className="text-neg">{formatMoney(-parseCents(projection.commit), context.numberFormat)}</dd>
        </div>
        <div>
          <dt className="text-muted">{text("projection.projected")}</dt>
          <dd className={cn("font-semibold", projected !== null && projected < 0n && "text-neg")}>
            {money(projection.projected)}
          </dd>
        </div>
      </dl>
      {projection.percent !== null && (
        <ProgressBar
          value={projection.percent / 100}
          tone={projection.percent > 50 ? "warn" : "accent"}
          label={text("projection.share")}
        />
      )}
    </div>
  );
}

function Projection({ view, context }: Props) {
  const text = useTranslations("subscriptions");
  const horizon = useSearchParams().get("proj") === "year" ? "year" : "month";
  const projections = view.projections[horizon];
  return (
    <Card className="flex flex-col gap-3" data-testid="projection">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{text("projection.title")}</h2>
        <LinkTabs
          label={text("projection.title")}
          path="/subscriptions"
          params={{}}
          name="proj"
          current={horizon}
          options={[
            { value: "month", label: text("projection.month") },
            { value: "year", label: text("projection.year") },
          ]}
        />
      </div>
      <p className="text-sm text-muted">
        {horizon === "year" ? text("projection.yearText") : text("projection.monthText")}
      </p>
      {projections.length === 0 && <p className="text-sm text-muted">{text("projection.empty")}</p>}
      {projections.map((projection) => (
        <ProjectionRow key={projection.accountId ?? "none"} projection={projection} context={context} />
      ))}
    </Card>
  );
}

function ByCategory({ view, context }: Props) {
  const text = useTranslations("subscriptions");
  const { money } = context;
  // The bars are drawn against the dearest group: a scale of the drawing, not a figure.
  const largest = view.byCategory.reduce((top, entry) => {
    const yearly = parseCents(entry.yearly);
    return yearly > top ? yearly : top;
  }, 0n);
  return (
    <Card padded={false}>
      <CardHeader title={text("byCategory.title")} />
      <ul className="flex flex-col gap-2 px-4 pb-4">
        {view.byCategory.map((entry) => {
          const name = entry.name ?? text("byCategory.uncategorised");
          const yearly = parseCents(entry.yearly);
          return (
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
                <span className="truncate">{name}</span>
              </span>
              <ProgressBar
                value={largest === 0n ? 0 : Number((yearly * 1000n) / largest) / 1000}
                label={name}
                color={entry.color ?? undefined}
              />
              <span className="text-right tabular-nums">{money(entry.yearly)}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Tables({ view, context }: Props) {
  const text = useTranslations("subscriptions");
  const { money } = context;
  const rows = view.subscriptions.map((row) => presentRow(row, text, context));
  const inactive = view.inactive.map((row) => presentRow(row, text, context));
  const paused = inactive.filter((row) => row.draft.state === "paused");
  const cancelled = inactive.filter((row) => row.draft.state === "cancelled");
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Card padded={false}>
        <SubscriptionsTable
          rows={rows}
          options={context.options}
          totals={{
            count: text("totalCount", { count: rows.length }),
            monthly: money(view.totals.monthly),
            yearly: money(view.totals.yearly),
          }}
        />
      </Card>
      {/* Two sections, not one list: a paused plan is waiting to come back, a cancelled one is
          over — and only the second offers to be thrown away (owner, 2026-09-21). */}
      <InactiveSubscriptions
        rows={paused}
        options={context.options}
        title={text("inactive.pausedTitle", { count: paused.length })}
      />
      <InactiveSubscriptions
        rows={cancelled}
        options={context.options}
        title={text("inactive.cancelledTitle", { count: cancelled.length })}
        deletable
      />
    </div>
  );
}

function SubscriptionsView({ view, context, suggest }: { view: View; context: Context; suggest: ReactNode }) {
  const text = useTranslations("subscriptions");
  const title = <h1 className="text-title font-semibold tracking-title max-md:sr-only">{text("title")}</h1>;
  if (view.subscriptions.length === 0 && view.inactive.length === 0)
    return (
      <>
        {title}
        <EmptyState
          title={text("empty.title")}
          description={text("empty.description")}
          actions={
            <AddSubscription
              draft={newDraft(context.today, context)}
              options={context.options}
              label={text("empty.cta")}
              size="md"
            />
          }
        />
        <div className="md:hidden">{suggest}</div>
      </>
    );
  return (
    <>
      <Alerts view={view} context={context} />
      <div className="flex flex-col gap-0.5">
        {title}
        <p className="text-muted tabular-nums">
          {text("subtitle", {
            count: view.subscriptions.length,
            monthly: context.money(view.totals.monthly),
          })}
        </p>
        <div className="mt-2 md:hidden">{suggest}</div>
      </div>
      <Kpis view={view} context={context} />
      <div className="grid items-start gap-4 @wide:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <Tables view={view} context={context} />
        {/* Beside the table only past the wide threshold; below it they share a row under it. */}
        <div className="grid min-w-0 items-start gap-4 @4xl:grid-cols-2 @wide:grid-cols-1">
          <Projection view={view} context={context} />
          <ByCategory view={view} context={context} />
        </div>
      </div>
    </>
  );
}

/** What the screen knows of the person and offers the dialog, once its reads are in. */
function useContext(view: View | undefined): Context | undefined {
  const prefs = useApi(profile.getPreferences, {}).data;
  const categories = useCategoryOptions("expense");
  if (!prefs || !view || !categories) return undefined;
  const numberFormat = numberStyle(prefs);
  return {
    numberFormat,
    money: (amount) => formatMoney(amount === null ? null : parseCents(amount), numberFormat),
    locale: prefs.locale,
    today: today(prefs.timeZone),
    options: { categories, accounts: view.accounts },
  };
}

export function SubscriptionsScreen() {
  const text = useTranslations("subscriptions");
  const read = useApi(subscriptionRoutes.listSubscriptions, {});
  const suggested = useApi(subscriptionRoutes.listSubscriptionSuggestions, {}).data;
  const context = useContext(read.data);
  const suggest = context && suggested && (
    <SuggestionsButton
      suggestions={suggested.suggestions.map((one) => presentSuggestion(one, text, context))}
      options={context.options}
    />
  );
  // Below 768 px the top bar has room for the primary action only; the suggestions move into the
  // page and the export, a desk task, stays on the larger screens.
  const actions = context && (
    <>
      <span className="contents max-md:hidden">
        <ExportLink />
        {suggest}
      </span>
      <AddSubscription
        draft={newDraft(context.today, context)}
        options={context.options}
        label={text("add")}
      />
    </>
  );
  return (
    <Page title={text("title")} actions={actions}>
      <Loaded state={read}>
        {(view) => (context ? <SubscriptionsView view={view} context={context} suggest={suggest} /> : null)}
      </Loaded>
    </Page>
  );
}
