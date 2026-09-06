import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { StaleBadge } from "@/components/ui/StaleBadge";
import { StatGrid, StatTile } from "@/components/ui/StatTile";
import { monthKey } from "@/lib/time";
import { ContributionsTable } from "@/modules/funds/ui/ContributionsTable";
import { ContributionForm } from "@/modules/funds/ui/ContributionForm";
import { CurrencyValue, formatSignedCurrency } from "@/modules/funds/ui/CurrencyValue";
import { FundFormTrigger } from "@/modules/funds/ui/FundForm";
import { FundValueChart, type FundChartSeries } from "@/modules/funds/ui/FundValueChart";
import { loadFundAccounts, loadFundDetail, loadFundIdBySlug } from "@/modules/funds/ui/load-funds";
import { PlanForm } from "@/modules/funds/ui/PlanForm";
import { MonthlyTable, QuarterTable } from "@/modules/funds/ui/QuarterTable";
import { AcknowledgeButton, ReconcileButton } from "@/modules/funds/ui/ReconciliationActions";
import { ScheduleForm } from "@/modules/funds/ui/ScheduleForm";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";

export const dynamic = "force-dynamic";
function asDate(value: string | null): Date | null { return value ? new Date(`${value}T12:00:00Z`) : null; }
function issueLabel(value: string): string { return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
function issueDetail(detail: Record<string, unknown>): string {
  const values = Object.values(detail).flatMap((value) => Array.isArray(value) ? value : [value]).filter((value) => typeof value === "string" || typeof value === "number");
  return values.length ? values.join(" · ") : "Review this fund's contribution records.";
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) { return { title: (await params).id }; }

export default async function FundDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const principal = await requirePrincipalOrRedirect();
  if (!principal.permissions.has("funds.read")) return <><PageHeader title="Funds" /><div className="max-w-xl pt-6"><EmptyState title="Fund unavailable" description="You do not have permission to view funds." /></div></>;
  if (!z.string().uuid().safeParse(id).success) {
    const fundId = await loadFundIdBySlug(id);
    if (!fundId) notFound();
    redirect(`/finance/funds/${fundId}`);
  }
  const detail = await loadFundDetail(id);
  if (!detail) notFound();
  const canWrite = principal.permissions.has("funds.write");
  const accounts = canWrite ? await loadFundAccounts() : [];
  const currentMonth = monthKey(new Date());
  const series: FundChartSeries[] = [
    { key: "value", label: "Value", points: detail.valueSeries.map((point) => ({ month: point.month, value: point.value })) },
    { key: "deposited", label: "Deposited", points: detail.valueSeries.map((point) => ({ month: point.month, value: point.deposited })) },
  ];
  const grouped = detail.schedule?.frequency === "quarterly" || detail.schedule?.frequency === "annual";

  return <>
    <PageHeader title={detail.fund.name} eyebrow={<Link href="/finance/funds" className="text-fg-muted transition-colors hover:text-fg">← Funds</Link>} action={canWrite ? <FundFormTrigger accounts={accounts} fund={detail.fund} /> : undefined} />
    <PageGrid className="pt-5">
      <Panel span={12} ariaLabel={`${detail.fund.name} summary`}><StatGrid columns={3}>
        <StatTile emphasis="primary" label="Value" value={<CurrencyValue value={detail.value} currency={detail.fund.currency} size="display-sm" />} sub={<StaleBadge capturedAt={asDate(detail.valueAsOf)} compact />} />
        <StatTile label="Deposited" value={<CurrencyValue value={detail.deposited} currency={detail.fund.currency} size="display-sm" />} />
        <StatTile label="Return" value={<span>{detail.absReturn === null ? "—" : formatSignedCurrency(detail.absReturn, detail.fund.currency)}</span>} delta={detail.absReturn === null ? undefined : <DeltaBadge value={detail.absReturn} formattedValue={formatSignedCurrency(detail.absReturn, detail.fund.currency)} context="return since inception" />} />
      </StatGrid></Panel>

      {detail.fund.accountId === null ? <Panel span={7} title="Value history"><EmptyState title="No valuation account linked" description="Link a valuation account to see its value." action={canWrite ? <FundFormTrigger accounts={accounts} fund={detail.fund} label="Link account" /> : undefined} /></Panel> : <Panel span={7} title="Value and deposited"><FundValueChart series={series} label={`${detail.fund.name}: value and deposited by month`} currency={detail.fund.currency} /></Panel>}

      <Panel span={5} title={grouped ? "Posting periods" : "Monthly postings"}>
        {grouped ? <QuarterTable rows={detail.quarters} currency={detail.fund.currency} frequency={detail.schedule!.frequency as "quarterly" | "annual"} /> : <MonthlyTable rows={detail.contributions} currency={detail.fund.currency} />}
      </Panel>

      <Panel span={12} title="Contributions"><ContributionsTable rows={detail.contributions} fundId={detail.fund.id} canWrite={canWrite} /></Panel>
      {canWrite && <Panel span={6} title="Add contribution" chrome="framed"><ContributionForm fundId={detail.fund.id} currentMonth={currentMonth} currency={detail.fund.currency} /></Panel>}
      {canWrite && <Panel span={6} title="Schedule" chrome="framed"><ScheduleForm fundId={detail.fund.id} schedule={detail.schedule} currentMonth={currentMonth} currency={detail.fund.currency} /></Panel>}
      {canWrite && <Panel span={6} title="Plan" chrome="framed"><PlanForm fundId={detail.fund.id} plan={detail.plan} currentMonth={currentMonth} currency={detail.fund.currency} hasPlans={detail.plans.length > 0} /></Panel>}
      <Panel span={6} title="Reconciliation" action={canWrite ? <ReconcileButton fundId={detail.fund.id} /> : undefined}>
        {detail.issues.length === 0 ? <p className="py-5 text-body-sm text-fg-muted">No open issues.</p> : <div className="hairline-t">{detail.issues.map((issue) => <div key={issue.id} className="flex min-h-16 flex-wrap items-center justify-between gap-3 py-3 hairline-b"><span className="min-w-0"><span className="block text-body font-medium text-fg">{issueLabel(issue.kind)}</span><span className="block text-body-sm text-fg-muted">{issue.severity} · {issueDetail(issue.detail)}</span></span>{canWrite && <AcknowledgeButton fundId={detail.fund.id} issueId={issue.id} />}</div>)}</div>}
      </Panel>
    </PageGrid>
  </>;
}
