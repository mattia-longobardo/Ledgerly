"use client";

// Accounts, read from `/api/v1` (rewrite plan R3): every figure is a field of `GET /net-worth`; the
// screen chooses the window and formats.
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { views } from "@ledgerly/api-contract/accounts";
import { profile } from "@ledgerly/api-contract/settings";
import type { RouteOutput } from "@ledgerly/api-client";
import { today } from "@ledgerly/format/dates";
import { formatPercent, numberStyle } from "@ledgerly/format/format";
import { ButtonLink } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import { CompositionCard } from "@ledgerly/ui/composition-card";
import { useApi } from "@ledgerly/ui/data";
import { KpiTile } from "@ledgerly/ui/kpi-tile";
import { ToggleLink } from "@ledgerly/ui/link-controls";
import { Loaded } from "@ledgerly/ui/loaded";
import { parsePeriodQuery, periodMonths, type PeriodQuery } from "@ledgerly/ui/period";
import { PeriodBar } from "@ledgerly/ui/period-bar";
import { Page } from "@ledgerly/ui/shell/page";
import { EmptyState } from "@ledgerly/ui/states";
import { withParams } from "@ledgerly/ui/url";
import { type CardFormat, NetWorthCard } from "@/modules/accounts/client";
import { AccountsTable, displayMoney, type NetWorth, PhoneList, type Row, rowsOf } from "./accounts-table";

type Preferences = RouteOutput<typeof profile.getPreferences>;

export function AccountsScreen() {
  const text = useTranslations("accounts");
  const preferences = useApi(profile.getPreferences, {});
  return (
    <Page
      title={text("title")}
      actions={
        <ButtonLink href="/accounts/new" variant="primary" size="sm">
          {text("add")}
        </ButtonLink>
      }
    >
      <Loaded state={preferences}>{(prefs) => <AccountsData prefs={prefs} />}</Loaded>
    </Page>
  );
}

function AccountsData({ prefs }: { prefs: Preferences }) {
  const search = useSearchParams();
  const query = Object.fromEntries(search.entries());
  // One period for the whole page, the Expenses control (PERS-342): the table's balances are those
  // of its last month, the chart draws all of it. `chart` is the chart's grain parameter.
  const todayOn = today(prefs.timeZone);
  const period = parsePeriodQuery(query, todayOn, "chart");
  // An archived account is off the list until it is asked for, and it stays out of the totals even
  // then: the same page must not give two different net worths depending on a checkbox.
  const showArchived = query.archived === "1";
  const end = periodMonths(period.range, todayOn).through;
  const read = useApi(views.getNetWorth, {
    query: { through: end, includeArchived: showArchived ? "true" : undefined },
  });
  const format: CardFormat = {
    locale: prefs.locale,
    timeZone: prefs.timeZone,
    numberFormat: numberStyle(prefs),
  };
  return (
    <Loaded state={read}>
      {(view) =>
        view.accounts.length === 0 ? (
          showArchived ? (
            <NoAccounts archived={0} />
          ) : (
            <NoOpenAccounts />
          )
        ) : (
          <AccountsView view={view} period={period} end={end} showArchived={showArchived} format={format} />
        )
      }
    </Loaded>
  );
}

/**
 * Somebody who archived their last account has not stopped having accounts, and the empty state
 * must not tell them they have: without this, archiving the only one left them looking at "No
 * accounts yet" with no checkbox anywhere to find it again.
 */
function NoOpenAccounts() {
  const read = useApi(views.getNetWorth, { query: { months: 1, includeArchived: "true" } });
  return (
    <Loaded state={read}>
      {(view) => <NoAccounts archived={view.accounts.filter((row) => row.state === "archived").length} />}
    </Loaded>
  );
}

function NoAccounts({ archived }: { archived: number }) {
  const text = useTranslations("accounts");
  return (
    <>
      <h1 className="text-title font-semibold tracking-title max-md:sr-only">{text("title")}</h1>
      <EmptyState
        title={text("empty.title")}
        description={archived > 0 ? text("empty.archived", { count: archived }) : text("empty.description")}
        actions={
          <>
            <ButtonLink href="/accounts/new" variant="primary">
              {text("add")}
            </ButtonLink>
            {archived > 0 && (
              <ButtonLink href={withParams("/accounts", {}, { archived: "1" })}>
                {text("showArchived")}
              </ButtonLink>
            )}
          </>
        }
      />
    </>
  );
}

function AccountsView({
  view,
  period,
  end,
  showArchived,
  format,
}: {
  view: NetWorth;
  period: PeriodQuery;
  end: string;
  showArchived: boolean;
  format: CardFormat;
}) {
  const text = useTranslations("accounts");
  const page = { archived: showArchived ? "1" : undefined };
  const rows = rowsOf(view, format);

  return (
    <>
      <Headline view={view} format={format} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodBar period={period} path="/accounts" carry={page} locale={format.locale} />
        <ToggleLink
          label={text("showArchived")}
          path="/accounts"
          params={{ ...period.params, ...page }}
          name="archived"
          on={showArchived}
        />
      </div>

      <Kpis view={view} format={format} />

      <Card padded={false}>
        {/* Eight columns do not fit a phone at any font size: below `md` the same accounts are a
            list, carrying every figure the table carries (plan F9 §3.3). */}
        <div className="overflow-x-auto max-md:hidden">
          <AccountsTable view={view} rows={rows} format={format} end={end} />
        </div>
        <PhoneList view={view} rows={rows} format={format} />
      </Card>

      {view.totalPartial && <p className="text-sm text-warn">{text("partial")}</p>}
      {view.missingRates.length > 0 && (
        <p className="text-sm text-warn">
          {text("missingRate", { currencies: view.missingRates.join(", "), currency: view.currency })}
        </p>
      )}

      <div className="grid gap-4 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* Overview's chart, on the page's period (`chart=` is its grain). */}
        <NetWorthCard
          format={format}
          period={period}
          path="/accounts"
          carry={page}
          grainParam="chart"
          controls={false}
        />
        <Composition view={view} rows={rows} format={format} />
      </div>
    </>
  );
}

/** The headline counts what the headline's total is made of, so the two never disagree. */
function liveCountOf(view: NetWorth): number {
  return view.accounts.filter((row) => row.state !== "archived").length;
}

function Headline({ view, format }: { view: NetWorth; format: CardFormat }) {
  const text = useTranslations("accounts");
  return (
    <div className="flex flex-wrap items-baseline gap-3">
      <h1 className="text-title font-semibold tracking-title">{text("title")}</h1>
      <p data-testid="accounts-summary" className="text-muted">
        {text("summary", { total: displayMoney(view.total, view, format), count: liveCountOf(view) })}
      </p>
    </div>
  );
}

function Kpis({ view, format }: { view: NetWorth; format: CardFormat }) {
  const text = useTranslations("accounts");
  const kpis = [
    { key: "total", total: view.total, count: liveCountOf(view) },
    { key: "cash", ...view.buckets.cash },
    { key: "savings", ...view.buckets.savings },
    { key: "investments", ...view.buckets.investments },
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
      {kpis.map((kpi) => (
        <KpiTile
          key={kpi.key}
          label={text(`kpis.${kpi.key}`)}
          value={displayMoney(kpi.total, view, format)}
          note={text("countAccounts", { count: kpi.count })}
        />
      ))}
    </div>
  );
}

function Composition({ view, rows, format }: { view: NetWorth; rows: Row[]; format: CardFormat }) {
  const text = useTranslations("accounts");
  const total = (amount: string | null) => displayMoney(amount, view, format);
  return (
    <CompositionCard
      title={text("composition.title")}
      tall
      muted={0}
      parts={rows.map((row) => ({
        key: row.id,
        label: row.name,
        color: row.color,
        share: row.share ?? 0,
        cells: [formatPercent(row.share, format.numberFormat), total(row.display.balance)],
      }))}
      footer={
        <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
          <div>
            <dt className="text-muted">{text("composition.liquid")}</dt>
            <dd className="font-medium tabular-nums">{total(view.buckets.cash.total)}</dd>
          </div>
          <div>
            <dt className="text-muted">{text("composition.invested")}</dt>
            <dd className="font-medium tabular-nums">{total(view.buckets.investments.total)}</dd>
          </div>
        </dl>
      }
    />
  );
}
