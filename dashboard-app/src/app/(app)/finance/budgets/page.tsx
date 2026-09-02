import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Budgets" };

/** Reserved route: the section exists in the navigation before it has anything to show. */
export default async function BudgetsPage() {
  await requirePrincipalOrRedirect();

  return (
    <>
      <PageHeader title="Budgets" />
      <div className="max-w-xl pt-6">
        <EmptyState title="Not available yet" description="This section arrives in a later release." />
      </div>
    </>
  );
}
