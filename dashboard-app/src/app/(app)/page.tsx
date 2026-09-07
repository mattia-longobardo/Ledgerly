import Link from "next/link";
import { TimeSeriesChart } from "@/components/chart/TimeSeriesChart";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { AccountList, AccountRow } from "@/components/ui/AccountRow";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { StaleBadge } from "@/components/ui/StaleBadge";
import { deltaOverRange } from "@/lib/calc/series";
import { formatDateLine } from "@/lib/format";
import type { Series } from "@/lib/contracts";
import { loadOverview, type SourceFreshness } from "@/modules/accounts/ui/load-overview";
import { activeBudgetsCard, loadBudgets } from "@/modules/budgets/ui/load-budgets";
import { cardState, shouldLoadCardData, visibleCards, type CardKey } from "@/modules/home/cards";
import type { FundSummary } from "@/modules/funds/application/summary";
import { CurrencyValue } from "@/modules/funds/ui/CurrencyValue";
import { fundValueCurrency, loadFundsSummary, totalFundValue } from "@/modules/funds/ui/load-funds";
import { loadImports, type ImportRow } from "@/modules/payroll/ui/load-payroll";
import { loadTimeoffSummary, type TimeoffSummary } from "@/modules/timeoff/ui/load-workspace";
import { AWAITING_STATUSES } from "@/modules/payroll/ui/queue";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { realProbes } from "@/platform/capabilities/probes";
import { resolveCapabilities } from "@/platform/capabilities/resolve";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

const CHART_MONTHS = 12;
const WALLET_SOURCE_NAME = "Budget Makers Wallet";

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

/** Rendered instead of a card's content when `cardState` denies the permission it requires. */
function PermissionDeniedPanel({ span, title }: { span: 4 | 6 | 8 | 12; title: string }) {
  return (
    <Panel span={span} spanMd={4} title={title}>
      <p className="text-body-sm text-fg-muted">You do not have access to this card.</p>
    </Panel>
  );
}

export default async function HomePage() {
  const principal = await requirePrincipalOrRedirect();
  const caps = await resolveCapabilities(principal, realProbes);
  const visible = visibleCards(caps);
  const isVisible = (key: CardKey) => visible.some((c) => c.key === key);
  const shouldLoad = (key: CardKey) => {
    const card = visible.find((candidate) => candidate.key === key);
    return card !== undefined && shouldLoadCardData(card, caps);
  };
  const denial = (key: CardKey) => {
    const card = visible.find((c) => c.key === key);
    return card ? cardState(card, caps) : null;
  };

  const [overview, funds, budgets, timeoff, imports] = await Promise.all([
    isVisible("total_balance") || isVisible("accounts_sync") ? loadOverview() : null,
    shouldLoad("funds") ? loadFundsSummary() : null,
    shouldLoad("budgets") ? loadBudgets() : null,
    isVisible("leave") ? loadTimeoffSummary() : null,
    // Safe to call unconditionally behind `isVisible`: this card requires the
    // `payroll` feature, which `resolveCapabilities` only turns on once a
    // document store is actually connected — the same guarantee `/company`
    // and `/company/payroll` rely on before calling into this module.
    isVisible("payroll_imports") ? loadImports() : null,
  ]);

  return (
    <>
      <PageHeader title="Total balance" eyebrow={formatDateLine(new Date())} action={<SettingsLink />} />

      <PageGrid className="pt-5">
        {isVisible("total_balance") &&
          (denial("total_balance") ? (
            <PermissionDeniedPanel span={8} title="Net worth" />
          ) : (
            <TotalBalanceCards overview={overview!} />
          ))}

        {isVisible("leave") &&
          (denial("leave") ? (
            <PermissionDeniedPanel span={4} title="Leave" />
          ) : (
            <LeaveCard summary={timeoff!} />
          ))}

        {isVisible("accounts_sync") &&
          (denial("accounts_sync") ? (
            <PermissionDeniedPanel span={4} title="Accounts sync" />
          ) : (
            <AccountsSyncCard sources={overview!.sources} />
          ))}

        {isVisible("funds") &&
          (denial("funds") ? (
            <PermissionDeniedPanel span={4} title="Funds" />
          ) : (
            <FundsCard funds={funds!} />
          ))}

        {isVisible("budgets") &&
          (denial("budgets") ? (
            <PermissionDeniedPanel span={4} title="Budgets" />
          ) : (
            <BudgetsCard summaries={budgets!} />
          ))}

        {isVisible("payroll_imports") &&
          (denial("payroll_imports") ? (
            <PermissionDeniedPanel span={4} title="Payroll imports" />
          ) : (
            <PayrollImportsCard imports={imports!} />
          ))}
      </PageGrid>
    </>
  );
}

/**
 * `total_balance`: the hero, its 12-month chart, and the account strip — one
 * card by gate (all three disappear together behind the same capability
 * check), rendered as three panels so the desktop grid can lay the chart and
 * the strip side by side.
 */
function TotalBalanceCards({ overview }: { overview: Awaited<ReturnType<typeof loadOverview>> }) {
  const { netWorth, accounts } = overview;

  // Empty exactly when no account is counted towards net worth — never a
  // zero standing in for "nothing here yet".
  const hasIncludedAccounts = netWorth.perAccount.length > 0;
  const total = hasIncludedAccounts ? (netWorth.total.at(-1)?.value ?? null) : null;
  const delta = deltaOverRange(netWorth.total, 1);

  const chartSeries: Series[] = [
    { key: "total", label: "Net worth", points: netWorth.total.slice(-CHART_MONTHS) },
  ];

  return (
    <>
      <Panel span={8} ariaLabel="Net worth" bodyClassName="axis-rule-live pb-6">
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

      {/* The curve for the figure above. The number and its history belong on
          the same screen; /finance is the drill-down, not the first read. */}
      {total !== null && (
        <Panel span={8} title="Last 12 months">
          <TimeSeriesChart series={chartSeries} label="Net worth by month" height={340} area />
        </Panel>
      )}

      {/* Account strip: every non-archived account, in the accounts module's
          own order. Links to Accounts for management. */}
      <Panel
        span={4}
        spanMd={4}
        title="Accounts"
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
    </>
  );
}

/**
 * `leave`: the remaining balance across every time off type, from the same
 * workspace read `/company/time-off` renders — so the card and the page can
 * never disagree.
 *
 * "—" when no payslip has ever written a balance. There is no ring any more:
 * a ring needs a total allowance to fill against, and this module records what
 * a payslip states as REMAINING, not an entitlement — the old ring's maximum
 * was remaining + taken, which is an invented denominator.
 */
function LeaveCard({ summary }: { summary: TimeoffSummary }) {
  const next = summary.upcoming[0] ?? null;

  return (
    <Panel
      span={4}
      spanMd={4}
      title="Leave"
      action={
        <Link
          href="/company/time-off"
          className="text-body-sm font-medium text-accent transition-colors hover:text-accent-hover"
        >
          Go to Time Off
        </Link>
      }
    >
      <div className="num text-display-sm text-fg">
        {summary.remainingDays === null ? "—" : `${summary.remainingDays} d`}
      </div>
      <p className="mt-1 text-caption text-fg-muted">
        {summary.remainingDays === null
          ? "No payslip balance on file yet."
          : "remaining across every type"}
      </p>
      {next !== null && (
        <p className="num mt-2 text-body-sm text-fg-muted">
          Next: {next.date} · {next.typeCode}
        </p>
      )}
      {summary.pendingCount > 0 && (
        <p className="mt-1 text-caption text-fg-muted">
          {summary.pendingCount} day{summary.pendingCount === 1 ? "" : "s"} waiting for the Trek sync
        </p>
      )}
    </Panel>
  );
}

/** `accounts_sync`: the Wallet source's freshness, from the same read `total_balance` uses. */
function AccountsSyncCard({ sources }: { sources: readonly SourceFreshness[] }) {
  const wallet = sources.find((s) => s.name === WALLET_SOURCE_NAME);

  return (
    <Panel
      span={4}
      spanMd={4}
      title="Accounts sync"
      action={
        <Link
          href="/settings/integrations/wallet"
          className="text-body-sm font-medium text-accent transition-colors hover:text-accent-hover"
        >
          Settings
        </Link>
      }
    >
      {!wallet || wallet.state === "missing" ? (
        <p className="text-body-sm text-fg-muted">{WALLET_SOURCE_NAME} has not synced yet.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-body text-fg">{WALLET_SOURCE_NAME}</span>
          <StaleBadge capturedAt={wallet.lastUpdated} stale={wallet.state === "stale"} />
        </div>
      )}
    </Panel>
  );
}

/** `funds`: the total of the same per-fund figures the Funds page shows individually. */
function FundsCard({ funds }: { funds: readonly FundSummary[] }) {
  const total = totalFundValue(funds);
  const currency = fundValueCurrency(funds);
  const valuedCurrencies = new Set(funds.filter((fund) => fund.value !== null).map((fund) => fund.fund.currency));
  const valueDates = funds.flatMap((fund) => fund.valueAsOf ? [new Date(`${fund.valueAsOf}T12:00:00Z`)] : []);
  const asOf = valueDates.length === 0 ? null : new Date(Math.min(...valueDates.map((date) => date.getTime())));

  return (
    <Panel
      span={4}
      spanMd={4}
      title="Funds"
      action={
        <Link href="/finance/funds" className="text-body-sm font-medium text-accent transition-colors hover:text-accent-hover">
          View all
        </Link>
      }
    >
      {funds.length === 0 ? (
        <p className="text-body-sm text-fg-muted">No funds registered.</p>
      ) : (
        <>
          {total.value !== null && currency !== null ? (
            <CurrencyValue value={total.value} currency={currency} size="display-sm" />
          ) : (
            <p className="text-body-sm text-fg-muted">
              {valuedCurrencies.size > 1 ? "Values span multiple currencies." : "No fund valuations yet."}
            </p>
          )}
          {total.unvalued > 0 && <p className="mt-1 text-caption text-fg-muted">{total.unvalued} fund{total.unvalued === 1 ? "" : "s"} without a valuation</p>}
          {asOf && <div className="mt-2"><StaleBadge capturedAt={asOf} /></div>}
        </>
      )}
    </Panel>
  );
}

/**
 * `budgets`: the count of active budgets and their combined remaining, via
 * the same pure `activeBudgetsCard` helper the Home card's own unit test
 * exercises directly (a `.test.tsx` never runs, so this component is a thin
 * wrapper — the logic worth testing lives in that helper, not here).
 */
function BudgetsCard({ summaries }: { summaries: Awaited<ReturnType<typeof loadBudgets>> }) {
  const { count, remaining } = activeBudgetsCard(summaries);

  return (
    <Panel
      span={4}
      spanMd={4}
      title="Budgets"
      action={
        <Link href="/finance/budgets" className="text-body-sm font-medium text-accent transition-colors hover:text-accent-hover">
          View all
        </Link>
      }
    >
      {count === 0 ? (
        <p className="text-body-sm text-fg-muted">No active budgets.</p>
      ) : (
        <>
          {remaining === null ? (
            <p className="text-body-sm text-fg-muted">Budgets span multiple currencies.</p>
          ) : (
            <MoneyValue value={remaining} size="display-sm" />
          )}
          <p className="mt-1 text-caption text-fg-muted">
            {count} active budget{count === 1 ? "" : "s"}
          </p>
        </>
      )}
    </Panel>
  );
}

/**
 * `payroll_imports`: how many payslips are still waiting for a decision, using
 * the same `AWAITING_STATUSES` the review queue itself is built from (Ruling
 * from Finding 3's fix) — so this count and the queue a reviewer opens by
 * following it always agree on what "still waiting" means.
 */
function PayrollImportsCard({ imports }: { imports: readonly ImportRow[] }) {
  const pending = imports.filter((row) => (AWAITING_STATUSES as readonly string[]).includes(row.status)).length;

  return (
    <Panel
      span={4}
      spanMd={4}
      title="Payroll imports"
      action={
        <Link href="/company/payroll" className="text-body-sm font-medium text-accent transition-colors hover:text-accent-hover">
          Go to Payroll
        </Link>
      }
    >
      {pending === 0 ? (
        <p className="text-body-sm text-fg-muted">Nothing is waiting for review.</p>
      ) : (
        <>
          <span className="num text-display-sm text-fg">{pending}</span>
          <p className="mt-1 text-body-sm text-fg-muted">
            {pending === 1 ? "payslip waiting for review" : "payslips waiting for review"}
          </p>
        </>
      )}
    </Panel>
  );
}
