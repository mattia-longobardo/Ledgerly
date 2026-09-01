import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { loadAccounts } from "../_lib/accounts";
import { FinanceTabs } from "./_components/FinanceTabs";
import { OverviewClient, type OverviewAccount } from "./_components/OverviewClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Finance" };

/** Ten years of month keys is the whole history in practice, and it is ≤120 points. */
const HISTORY_MONTHS = 120;

export default async function FinanceOverviewPage() {
  await requireUserOrRedirect("/finance");

  const accounts = await loadAccounts(HISTORY_MONTHS);
  // The managed accounts plus each VISIBLE hand-tracked account as its own row.
  // Hidden ones are omitted from the list but still sit inside `accounts.total`.
  const visibleHandTracked = accounts.handTracked.filter((a) => a.visible);
  const list: OverviewAccount[] = [...accounts.managed, ...visibleHandTracked].map((a) => ({
    key: a.key,
    label: a.label,
    balance: a.balance,
    capturedAt: a.capturedAt,
    stale: a.stale,
    points: a.points,
  }));

  // The total is a sum of the rows in `list`, so it is non-null exactly when at
  // least one of them is. Both are checked anyway — cheap, and it keeps the
  // empty state honest if the definition ever changes again.
  const hasData = accounts.total.balance !== null || list.some((a) => a.balance !== null);

  return (
    <main className="pb-8">
      <PageHeader title="Finance" segmented={<FinanceTabs />} />

      {hasData ? (
        <OverviewClient
          total={{
            key: accounts.total.key,
            // Net worth: Σ of the latest known value of every account below.
            label: "Total wealth",
            balance: accounts.total.balance,
            capturedAt: accounts.total.capturedAt,
            stale: accounts.total.stale,
            points: accounts.total.points,
          }}
          accounts={list}
          earliestMonth={accounts.earliestMonth}
        />
      ) : (
        <div className="px-4 pt-4">
          <EmptyState
            title="No history yet"
            description="Balances arrive with the monthly snapshot job. Once it has run at least twice there is a curve to draw."
            action={
              <Link
                href="/settings"
                className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast"
              >
                Run the snapshot job
              </Link>
            }
          />
        </div>
      )}
    </main>
  );
}
