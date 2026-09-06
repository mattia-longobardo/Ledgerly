import Link from "next/link";
import { notFound } from "next/navigation";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { TimeSeriesChart } from "@/components/chart/TimeSeriesChart";
import type { Series } from "@/lib/contracts";
import { romeDate } from "@/lib/time";
import { AllocationForm } from "@/modules/budgets/ui/AllocationForm";
import { AllocationsTable } from "@/modules/budgets/ui/AllocationsTable";
import { BudgetFigures } from "@/modules/budgets/ui/BudgetFigures";
import { BudgetFormTrigger } from "@/modules/budgets/ui/BudgetForm";
import {
  loadBudgetAccounts,
  loadBudgetCategories,
  loadBudgetDetail,
  loadBudgetFunds,
  loadBudgetLabels,
} from "@/modules/budgets/ui/load-budgets";
import { ManualUsageForm } from "@/modules/budgets/ui/ManualUsageForm";
import { ScopesForm } from "@/modules/budgets/ui/ScopesForm";
import { UsagesTable } from "@/modules/budgets/ui/UsagesTable";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: (await params).id };
}

function eventLabel(kind: string): string {
  return kind.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export default async function BudgetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const principal = await requirePrincipalOrRedirect();
  if (!principal.permissions.has("budgets.read")) {
    return (
      <>
        <PageHeader title="Budgets" />
        <div className="max-w-xl pt-6">
          <EmptyState title="Budget unavailable" description="You do not have permission to view budgets." />
        </div>
      </>
    );
  }

  const detail = await loadBudgetDetail(id);
  if (!detail) notFound();

  const canWrite = principal.permissions.has("budgets.write");
  // Sequential, never nested: each loader opens its own module's context.
  // Loaded for every reader, not just a writer — a read-only viewer's
  // "Scopes" panel resolves names from these too, rather than showing a
  // raw account/category/label/fund id.
  const accounts = await loadBudgetAccounts();
  const funds = await loadBudgetFunds();
  const categories = await loadBudgetCategories();
  const labels = await loadBudgetLabels();
  const scopeNames = new Map(
    [...accounts, ...funds, ...categories, ...labels].map((option) => [option.id, option.name]),
  );

  const today = romeDate(new Date());
  const series: Series[] = [
    { key: "remaining", label: "Remaining", points: detail.series.map((point) => ({ month: point.month, value: Number(point.remaining) })) },
  ];

  return (
    <>
      <PageHeader
        title={detail.budget.name}
        eyebrow={
          <Link href="/finance/budgets" className="text-fg-muted transition-colors hover:text-fg">
            &larr; Budgets
          </Link>
        }
        action={canWrite ? <BudgetFormTrigger budget={detail.budget} /> : undefined}
      />
      <PageGrid className="pt-5">
        <Panel span={12} ariaLabel={`${detail.budget.name} figures`}>
          <BudgetFigures budgetId={detail.budget.id} figures={detail.figures} versions={detail.versions} canWrite={canWrite} today={today} />
        </Panel>

        <Panel span={12} title="Remaining by month">
          <TimeSeriesChart series={series} label={`${detail.budget.name}: remaining by month`} height={280} />
        </Panel>

        <Panel span={12} title="Allocations">
          <AllocationsTable rows={detail.allocations} budgetId={detail.budget.id} canWrite={canWrite} today={today} />
        </Panel>
        {canWrite && (
          <Panel span={6} title="Add allocation" chrome="framed">
            <AllocationForm budgetId={detail.budget.id} today={today} accounts={accounts} funds={funds} />
          </Panel>
        )}

        <Panel span={6} title="Scopes" chrome={canWrite ? "framed" : "plain"}>
          {canWrite ? (
            <ScopesForm budgetId={detail.budget.id} scopes={detail.scopes} accounts={accounts} categories={categories} labels={labels} funds={funds} />
          ) : detail.scopes.length === 0 ? (
            <p className="text-body-sm text-fg-muted">No scopes set.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-body-sm text-fg">
              {detail.scopes.map((scope) => (
                <li key={scope.id}>
                  {scope.kind.replace(/^./, (letter) => letter.toUpperCase())} · {scopeNames.get(scope.refId) ?? "Deleted"}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel span={12} title="Usage">
          <UsagesTable rows={detail.usages} budgetId={detail.budget.id} canWrite={canWrite} />
        </Panel>
        {canWrite && (
          <Panel span={6} title="Add manual usage" chrome="framed">
            <ManualUsageForm budgetId={detail.budget.id} today={today} />
          </Panel>
        )}

        <Panel span={6} title="Events">
          {detail.events.length === 0 ? (
            <p className="text-body-sm text-fg-muted">Nothing recorded yet.</p>
          ) : (
            <ul className="hairline-t">
              {detail.events.map((event) => (
                <li key={event.id} className="flex min-h-11 items-center justify-between gap-3 py-2 hairline-b">
                  <span className="text-body-sm text-fg">{eventLabel(event.kind)}</span>
                  <span className="num text-caption text-fg-muted">{event.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </PageGrid>
    </>
  );
}
