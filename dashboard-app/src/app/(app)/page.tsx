import Link from "next/link";
import { Sparkline } from "@/components/chart/Sparkline";
import { TimeSeriesChart } from "@/components/chart/TimeSeriesChart";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { AccountList, AccountRow } from "@/components/ui/AccountRow";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { StaleBadge } from "@/components/ui/StaleBadge";
import { carryForward, deltaOverRange, rangeToMonths } from "@/lib/calc/series";
import { formatDateLine, formatDays, formatNumber } from "@/lib/format";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import type { Series } from "@/lib/contracts";
import { loadAccounts, type AccountView } from "./_lib/accounts";
import { loadFerie } from "./_lib/vacation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

function spark(account: AccountView) {
  return <Sparkline values={carryForward(account.points).map((p) => p.value)} />;
}

/**
 * The net-worth curve for the figure directly above it. Built here on the
 * server: `TimeSeriesChart` is a client leaf, but it takes plain data, so Home
 * stays a Server Component. Fixed at 12 months and deliberately not
 * interactive; /finance owns range and per-account selection.
 */
function netWorthSeries(total: AccountView, earliestMonth: string | null): Series[] {
  const months = rangeToMonths("12M", { earliest: earliestMonth });
  const byMonth = new Map(carryForward(total.points).map((p) => [p.month, p.value] as const));
  return [
    {
      key: total.key,
      label: "Net worth",
      points: months.map((month) => ({ month, value: byMonth.get(month) ?? null })),
    },
  ];
}

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

  const [accounts, ferie] = await Promise.all([loadAccounts(), loadFerie()]);
  const { total, managed, revolutSubs, handTracked } = accounts;
  const visibleHandTracked = handTracked.filter((a) => a.visible);
  const delta = deltaOverRange(total.points, 1);

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
          {/* Hero — net worth, summed here from the latest known value of every
              account: the four the app reads plus the five hand-tracked ones.
              Teable's TOTAL column is deliberately not used; its formula omits
              Fondo Cometa, and on the rows this app appends (Date + ING +
              Revolut only) it omits every hand-tracked account too. The chart
              below is built from the same sum, so the two always agree. */}
          {total.balance === null ? (
            <EmptyState
              title="No balances yet"
              description="Nothing has been snapshotted from Teable or Wallet so far. Run the snapshot job once and this page fills in."
              action={
                <Link
                  href="/settings"
                  className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
                >
                  Open settings
                </Link>
              }
            />
          ) : (
            <>
              <MoneyValue value={total.balance} size="display-lg" cents="muted" />
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                {delta.abs !== null && (
                  <DeltaBadge value={delta.abs} percent={delta.pct} context="versus last month" />
                )}
                <StaleBadge capturedAt={total.capturedAt} stale={total.stale} />
              </div>
            </>
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
        {total.balance !== null && (
          <Panel span={8} title="Last 12 months" className="order-2 lg:order-none">
            <TimeSeriesChart
              series={netWorthSeries(total, accounts.earliestMonth)}
              label="Net worth by month"
              height={340}
              area
            />
          </Panel>
        )}

        {/* Account strip. Revolut opens onto its sub-accounts; each visible
            hand-tracked account is its own row (an empty Teable cell reads as
            0), and a hidden one simply gets no row while still counting in the
            total above. */}
        <Panel span={4} spanMd={4} title="Accounts" className="order-4 lg:order-none">
          <AccountList>
            {managed.map((account) =>
              account.key === "revolut_total" ? (
                <AccountRow
                  key={account.key}
                  name={account.label}
                  value={account.balance}
                  capturedAt={account.capturedAt}
                  stale={account.stale}
                  sparkline={spark(account)}
                >
                  {revolutSubs.map((sub) => (
                    <AccountRow
                      key={sub.key}
                      nested
                      name={sub.label}
                      value={sub.balance}
                      capturedAt={sub.capturedAt}
                      stale={sub.stale}
                    />
                  ))}
                </AccountRow>
              ) : (
                <AccountRow
                  key={account.key}
                  name={account.label}
                  value={account.balance}
                  capturedAt={account.capturedAt}
                  stale={account.stale}
                  sparkline={spark(account)}
                />
              ),
            )}

            {visibleHandTracked.map((account) => (
              <AccountRow
                key={account.key}
                name={account.label}
                value={account.balance}
                capturedAt={account.capturedAt}
                stale={account.stale}
                sparkline={spark(account)}
              />
            ))}
          </AccountList>
        </Panel>
      </PageGrid>
    </>
  );
}
