import Link from "next/link";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { BudgetFormTrigger } from "@/modules/budgets/ui/BudgetForm";
import { loadBudgets } from "@/modules/budgets/ui/load-budgets";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Budgets" };

function periodLabel(kind: string): string {
  return kind === "none" ? "No period" : kind.replace(/^./, (letter) => letter.toUpperCase());
}

export default async function BudgetsPage() {
  const principal = await requirePrincipalOrRedirect();
  const canRead = principal.permissions.has("budgets.read");
  const canWrite = principal.permissions.has("budgets.write");

  if (!canRead) {
    return (
      <>
        <PageHeader title="Budgets" />
        <div className="max-w-xl pt-6">
          <EmptyState title="Budgets unavailable" description="You do not have permission to view budgets." />
        </div>
      </>
    );
  }

  const summaries = await loadBudgets();
  const create = canWrite ? <BudgetFormTrigger /> : undefined;

  return (
    <>
      <PageHeader title="Budgets" action={summaries.length > 0 ? create : undefined} />
      {summaries.length === 0 ? (
        <div className="max-w-xl pt-6">
          <EmptyState title="No budgets yet" description="Create a budget to track its opening amount, allocations and spending." action={create} />
        </div>
      ) : (
        <PageGrid className="pt-5">
          <Panel span={12} ariaLabel="Budgets">
            <div className="hairline-t">
              {summaries.map((summary) => {
                const { budget, figures } = summary;
                return (
                  <Link
                    key={budget.id}
                    href={`/finance/budgets/${budget.id}`}
                    className="grid min-h-20 gap-3 py-3 hairline-b transition-colors hover:bg-surface-hover @xl:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(7rem,1fr))_auto] @xl:items-center @xl:px-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-body font-medium text-fg">{budget.name}</span>
                      <span className="text-caption text-fg-muted">{periodLabel(budget.periodKind)}</span>
                    </span>
                    <span>
                      <span className="block text-caption tracking-wide text-fg-muted uppercase">Remaining</span>
                      <MoneyValue value={figures.remaining} />
                    </span>
                    <span>
                      <span className="block text-caption tracking-wide text-fg-muted uppercase">Status</span>
                      <span className="text-body-sm text-fg">{budget.status === "active" ? "Active" : "Archived"}</span>
                    </span>
                    <span>
                      {figures.goalProgress === null ? (
                        <span className="text-caption text-fg-muted">No goal set</span>
                      ) : (
                        <ProgressRing value={figures.goalProgress} max={1} label={`${budget.name} goal progress`} size={56} thickness={5} />
                      )}
                    </span>
                    <span className="text-right text-body-sm font-medium text-accent">Open →</span>
                  </Link>
                );
              })}
            </div>
          </Panel>
        </PageGrid>
      )}
    </>
  );
}
