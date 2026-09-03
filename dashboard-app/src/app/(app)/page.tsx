import Link from "next/link";
import { TimeSeriesChart } from "@/components/chart/TimeSeriesChart";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { AccountList, AccountRow } from "@/components/ui/AccountRow";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { StaleBadge } from "@/components/ui/StaleBadge";
import { deltaOverRange } from "@/lib/calc/series";
import { formatDateLine, formatDays, formatNumber } from "@/lib/format";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import type { Series } from "@/lib/contracts";
import { loadOverview } from "@/modules/accounts/ui/load-overview";
import { loadFerie } from "./_lib/vacation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

const CHART_MONTHS = 12;

/** Mobile only: on desktop the sidebar already carries this. */
function SettingsLink() {
  return (
    <Link
      href="/settings"
      aria-label="Settings"
      className="inline-flex size-11 items-center justify-center rounded-md border border-border bg-surface text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg lg:hidden"
    >
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        width={18}
        height={18}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx={10} cy={10} r={2.75} />
        <path d="M10 2.5v1.75M10 15.75v1.75M2.5 10h1.75M15.75 10h1.75M4.7 4.7l1.24 1.24M14.06 14.06l1.24 1.24M15.3 4.7l-1.24 1.24M5.94 14.06 4.7 15.3" />
      </svg>
    </Link>
  );
}

export default async function HomePage() {
  await requireUserOrRedirect("/");

  const [overview, ferie] = await Promise.all([loadOverview(), loadFerie()]);
  const { netWorth, accounts } = overview;

  // Empty exactly when no account is counted towards net worth — never a
  // zero standing in for "nothing here yet".
  const hasIncludedAccounts = netWorth.perAccount.length > 0;
  const total = hasIncludedAccounts ? (netWorth.total.at(-1)?.value ?? null) : null;
  const delta = deltaOverRange(netWorth.total, 1);

  const chartSeries: Series[] = [
    { key: "total", label: "Net worth", points: netWorth.total.slice(-CHART_MONTHS) },
  ];

  const remainingDays = ferie.remaining.combinedDays;
  const ringMax = (remainingDays ?? 0) + ferie.takenDaysYtd;

  return (
    <>
      <PageHeader title="Total balance" eyebrow={formatDateLine(new Date())} action={<SettingsLink />} />

      {/*
        Two reads on the top row, their detail on the second. `order` puts the
        curve above the leave gauge on a phone, where the plan reads top to
        bottom; from `lg` the DOM order is the grid order and the gauge sits
        beside the figure it is not competing with.
      */}
      <PageGrid className="pt-5">
        <Panel
          span={8}
          ariaLabel="Net worth"
          className="order-1 lg:order-none"
          bodyClassName="axis-rule-live pb-6"
        >
          {/* Hero — net worth, the last known value of every account counted
              towards it, from the accounts module's own series. Links to the
              Accounts screen, which is the detail behind this figure. */}
          {total === null ? (
            <EmptyState
              title="No balances yet"
              description="Add an account, or connect Budget Makers Wallet, and this page fills in."
              action={
                <Link
                  href="/finance/accounts"
                  className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
                >
                  Go to Accounts
                </Link>
              }
            />
          ) : (
            <Link href="/finance/accounts" className="block transition-opacity hover:opacity-80">
              <MoneyValue value={total} size="display-lg" cents="muted" />
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                {delta.abs !== null && (
                  <DeltaBadge value={delta.abs} percent={delta.pct} context="versus last month" />
                )}
                <StaleBadge capturedAt={netWorth.asOf} stale={netWorth.stale} />
              </div>
            </Link>
          )}
        </Panel>

        {/* Vacation gauge — payslip-authoritative residuals, shown in days. */}
        <Panel
          span={4}
          spanMd={4}
          ariaLabel="Leave remaining"
          className="order-3 lg:order-none"
          bodyClassName="axis-rule flex items-center gap-4 pb-6"
        >
          <ProgressRing
            value={remainingDays ?? 0}
            max={ringMax > 0 ? ringMax : 1}
            label="Leave remaining this year"
          >
            <span className="text-caption">{formatNumber(remainingDays)}</span>
          </ProgressRing>
          <div className="min-w-0">
            <div className="text-caption tracking-wide text-fg-muted uppercase">Ferie + ROL</div>
            <div className="num text-display-sm text-fg">
              {remainingDays === null ? "-" : formatDays(remainingDays)}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="num text-caption text-fg-muted">
                {formatNumber(ferie.takenDaysYtd)} d taken in {ferie.year}
              </span>
              <StaleBadge
                capturedAt={ferie.latest?.verifiedAt ?? null}
                stale={ferie.latest === null}
              />
            </div>
          </div>
        </Panel>

        {/* The curve for the figure above. The number and its history belong on
            the same screen; /finance is the drill-down, not the first read. */}
        {total !== null && (
          <Panel span={8} title="Last 12 months" className="order-2 lg:order-none">
            <TimeSeriesChart series={chartSeries} label="Net worth by month" height={340} area />
          </Panel>
        )}

        {/* Account strip: every non-archived account, in the accounts module's
            own order. Links to Accounts for management. */}
        <Panel
          span={4}
          spanMd={4}
          title="Accounts"
          className="order-4 lg:order-none"
          action={
            <Link href="/finance/accounts" className="text-body-sm font-medium text-accent transition-colors hover:text-accent-hover">
              View all
            </Link>
          }
        >
          {accounts.length === 0 ? (
            <p className="text-body-sm text-fg-muted">No accounts yet.</p>
          ) : (
            <AccountList>
              {accounts.map((item) => (
                <AccountRow
                  key={item.account.id}
                  name={item.account.name}
                  value={item.latest?.balance ?? null}
                  capturedAt={item.latest?.capturedAt ?? null}
                  stale={item.stale}
                />
              ))}
            </AccountList>
          )}
        </Panel>
      </PageGrid>
    </>
  );
}
