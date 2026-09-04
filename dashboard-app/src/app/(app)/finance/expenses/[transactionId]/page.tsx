import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { loadTransactionDetail } from "@/modules/expenses/ui/load-transactions";
import { TransactionEditForm } from "@/modules/expenses/ui/TransactionEditForm";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ transactionId: string }> }) {
  const { transactionId } = await params;
  const detail = await loadTransactionDetail(transactionId).catch(() => null);
  return { title: detail?.row.payee ?? "Transaction" };
}

export default async function TransactionDetailPage({
  params,
}: {
  params: Promise<{ transactionId: string }>;
}) {
  await requirePrincipalOrRedirect();
  const { transactionId } = await params;
  const detail = await loadTransactionDetail(transactionId);
  if (!detail) notFound();

  return (
    <>
      <PageHeader
        title={detail.row.payee ?? "Transaction"}
        eyebrow={
          <Link href="/finance/expenses" className="text-fg-muted transition-colors hover:text-fg">
            &larr; Expenses
          </Link>
        }
      />
      <div className="max-w-md pt-6">
        <TransactionEditForm row={detail.row} categories={detail.categories} />
      </div>
    </>
  );
}
