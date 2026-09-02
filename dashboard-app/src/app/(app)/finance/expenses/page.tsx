import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Expenses" };

/** Reserved route: the section exists in the navigation before it has anything to show. */
export default async function ExpensesPage() {
  await requirePrincipalOrRedirect();

  return (
    <>
      <PageHeader title="Expenses" />
      <div className="max-w-xl pt-6">
        <EmptyState title="Not available yet" description="This section arrives in a later release." />
      </div>
    </>
  );
}
