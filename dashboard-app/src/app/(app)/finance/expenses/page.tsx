import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { loadTransactionsPage } from "@/modules/expenses/ui/load-transactions";
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

  const page = await loadTransactionsPage({ limit: PAGE_SIZE });

  return (
    <>
      <PageHeader title="Expenses" />
      <div className="pt-6">
        <TransactionsTable
          initialRows={page.rows}
          initialNextCursor={page.nextCursor}
          pageSize={PAGE_SIZE}
        />
      </div>
    </>
  );
}
