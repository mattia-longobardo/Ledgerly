import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { loadOverview } from "@/modules/accounts/ui/load-overview";
import { FinanceTabs } from "./_components/FinanceTabs";
import { OverviewClient, type OverviewAccount, type OverviewSource } from "./_components/OverviewClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Finance" };

/** Ten years of month keys is the whole history in practice, and it is ≤120 points. */
const HISTORY_MONTHS = 120;

export default async function FinanceOverviewPage() {
  await requireUserOrRedirect("/finance");

  const { netWorth, accounts, sources } = await loadOverview(HISTORY_MONTHS);
  const staleById = new Map(accounts.map((a) => [a.account.id, a.stale]));

  // The rows below the chart: every account net worth counts, with the
  // staleness `listAccounts` already computed for it.
  const list: OverviewAccount[] = netWorth.perAccount.map((row) => ({
    key: row.account.id,
    label: row.account.name,
    balance: row.latest?.balance ?? null,
    capturedAt: row.latest?.capturedAt ?? null,
    stale: staleById.get(row.account.id) ?? false,
    points: row.series,
  }));

  const dataSources: OverviewSource[] = sources.map((s) => ({
    name: s.name,
    lastUpdated: s.lastUpdated,
    state: s.state,
  }));

  const hasData = netWorth.perAccount.length > 0;

  return (
    <>
      <PageHeader title="Finance" segmented={<FinanceTabs />} />

      {hasData ? (
        <OverviewClient
          total={{
            key: "total",
            label: "Total wealth",
            balance: netWorth.total.at(-1)?.value ?? null,
            capturedAt: netWorth.asOf,
            stale: netWorth.stale,
            points: netWorth.total,
          }}
          accounts={list}
          earliestMonth={netWorth.months[0] ?? null}
          sources={dataSources}
        />
      ) : (
        <div className="max-w-xl pt-6">
          <EmptyState
            title="No accounts yet"
            description="Add an account by hand, or connect Budget Makers Wallet to bring in what it already tracks."
            action={
              <Link
                href="/finance/accounts"
                className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
              >
                Go to Accounts
              </Link>
            }
          />
        </div>
      )}
    </>
  );
}
