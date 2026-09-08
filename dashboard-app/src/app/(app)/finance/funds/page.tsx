import Link from "next/link";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { StaleBadge } from "@/components/ui/StaleBadge";
import { CurrencyValue, formatSignedCurrency } from "@/modules/funds/ui/CurrencyValue";
import { FundFormTrigger } from "@/modules/funds/ui/FundForm";
import { loadFundAccounts, loadFundsSummary } from "@/modules/funds/ui/load-funds";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { FinanceTabs } from "../_components/FinanceTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Funds" };

function asDate(value: string | null): Date | null { return value ? new Date(`${value}T12:00:00Z`) : null; }
function label(value: string): string { return value.replace(/^./, (letter) => letter.toUpperCase()); }

export default async function FundsPage() {
  const principal = await requirePrincipalOrRedirect();
  const canRead = principal.permissions.has("funds.read");
  const canWrite = principal.permissions.has("funds.write");
  if (!canRead) return <><PageHeader title="Funds" segmented={<FinanceTabs />} /><div className="max-w-xl pt-6"><EmptyState title="Funds unavailable" description="You do not have permission to view funds." /></div></>;

  const funds = await loadFundsSummary();
  const accounts = canWrite ? await loadFundAccounts() : [];
  const create = canWrite ? <FundFormTrigger accounts={accounts} /> : undefined;

  return <>
    <PageHeader title="Funds" segmented={<FinanceTabs />} action={funds.length > 0 ? create : undefined} />
    {funds.length === 0 ? <div className="max-w-xl pt-6"><EmptyState title="No funds yet" description="Create a fund to track its contributions, plan and valuation." action={create} /></div> : <PageGrid className="pt-5"><Panel span={12} ariaLabel="Funds"><div className="hairline-t">
      {funds.map((summary) => <Link key={summary.fund.id} href={`/finance/funds/${summary.fund.id}`} className="grid min-h-20 gap-2 py-3 hairline-b transition-colors hover:bg-surface-hover @xl:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(7rem,1fr))] @xl:items-center @xl:px-2">
        <span className="min-w-0"><span className="block truncate text-body font-medium text-fg">{summary.fund.name}</span><span className="text-caption text-fg-muted">{label(summary.fund.kind)}{summary.openIssues > 0 ? ` · ${summary.openIssues} open issue${summary.openIssues === 1 ? "" : "s"}` : ""}</span></span>
        <span><span className="block text-caption tracking-wide text-fg-muted uppercase">Value</span><CurrencyValue value={summary.value} currency={summary.fund.currency} /><span className="block"><StaleBadge capturedAt={asDate(summary.valueAsOf)} compact /></span></span>
        <span><span className="block text-caption tracking-wide text-fg-muted uppercase">Deposited</span><CurrencyValue value={summary.deposited} currency={summary.fund.currency} /></span>
        <span><span className="block text-caption tracking-wide text-fg-muted uppercase">Return</span>{summary.absReturn === null ? <span className="num text-body text-fg-muted">—</span> : <DeltaBadge value={summary.absReturn} formattedValue={formatSignedCurrency(summary.absReturn, summary.fund.currency)} context="return since inception" />}</span>
        <span className="text-right text-body-sm font-medium text-accent">Open →</span>
      </Link>)}
    </div></Panel></PageGrid>}
  </>;
}
