import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { loadRecurringPatterns, loadTransactionsPage } from "@/modules/expenses/ui/load-transactions";
import { TransactionsTable } from "@/modules/expenses/ui/TransactionsTable";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { realProbes } from "@/platform/capabilities/probes";
import { resolveCapabilities } from "@/platform/capabilities/resolve";

export const dynamic = "force-dynamic";
export const metadata = { title: "Expenses" };

const PAGE_SIZE = 50;

/**
 * Two distinct "nothing to show" situations, read differently on purpose:
 * Wallet disconnected (`caps.features.expenses` false) keeps the existing
 * "Connect Budget Makers Wallet" empty state below; Wallet connected but
 * nothing synced yet renders the table, which reports that itself.
 */
export default async function ExpensesPage() {
  const principal = await requirePrincipalOrRedirect();
  const caps = await resolveCapabilities(principal, realProbes);

  if (!caps.features.expenses) {
    return (
      <>
        <PageHeader title="Expenses" />
        <div className="max-w-xl pt-6">
          <EmptyState
            title="Connect Budget Makers Wallet"
            description="Expenses are read from your Wallet transactions. Connect the integration and the first sync will fill this page."
            action={
              <Link
                href="/settings/integrations/wallet"
                className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
              >
                Go to Integrations
              </Link>
            }
          />
        </div>
      </>
    );
  }

  const [page, patterns] = await Promise.all([
    loadTransactionsPage({ limit: PAGE_SIZE }),
    loadRecurringPatterns(),
  ]);

  return (
    <>
      <PageHeader title="Expenses" />
      <div className="pt-6">
        <TransactionsTable
          initialRows={page.rows}
          initialNextCursor={page.nextCursor}
          pageSize={PAGE_SIZE}
        />
        {patterns.length > 0 ? (
          <div className="pt-8">
            <h2 className="text-body-sm font-medium text-muted">Recurring</h2>
            <ul className="mt-2 flex flex-col gap-1 text-body-sm">
              {patterns.map((p) => (
                <li key={p.id}>
                  {p.payee} — {p.cadence}, {p.amountLow === p.amountHigh ? p.amountLow : `${p.amountLow}–${p.amountHigh}`} {p.currency}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </>
  );
}
