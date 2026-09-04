import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { NotFoundError } from "@/modules/expenses/application/errors";
import { loadTransactionDetail } from "@/modules/expenses/ui/load-transactions";
import { TransactionEditForm } from "@/modules/expenses/ui/TransactionEditForm";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ transactionId: string }> }) {
  const { transactionId } = await params;
  // Only a missing transaction renders a generic title — anything else (a
  // database failure, a permission edge, a bug in the use case) is a real
  // error and must surface as one, matching `loadTransactionDetail`'s own
  // narrowing for the page body just below.
  const detail = await loadTransactionDetail(transactionId).catch((err: unknown) => {
    if (err instanceof NotFoundError) return null;
    throw err;
  });
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
