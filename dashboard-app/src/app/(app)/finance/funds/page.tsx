import Link from "next/link";
import { Sparkline } from "@/components/chart/Sparkline";
import { PageHeader } from "@/components/layout/PageHeader";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { StaleBadge } from "@/components/ui/StaleBadge";
import { carryForward } from "@/lib/calc/series";
import { formatEur } from "@/lib/format";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { FinanceTabs } from "../_components/FinanceTabs";
import { MonthlyGainPanel } from "../_components/MonthlyGainPanel";
import { loadFunds } from "../_lib/funds";
import { loadPortfolioGain } from "../_lib/gain";

export const dynamic = "force-dynamic";
export const metadata = { title: "Funds" };

export default async function FundsPage() {
  await requireUserOrRedirect("/finance/funds");
  const [funds, gain] = await Promise.all([loadFunds(), loadPortfolioGain()]);

  return (
    <main className="pb-8">
      <PageHeader title="Funds" segmented={<FinanceTabs />} />

      {funds.length === 0 ? (
        <div className="px-4 pt-4">
          <EmptyState
            title="No funds registered"
            description="Fideuram and Fondo Cometa are seeded by the database migration. If this is empty, the migration has not run yet."
            action={
              <Link
                href="/settings"
                className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast"
              >
                Open settings
              </Link>
            }
          />
        </div>
      ) : (
        <div className="grid gap-3 px-4 pt-4 sm:grid-cols-2">
          {funds.map((view) => (
            <Link
              key={view.fund.id}
              href={`/finance/funds/${view.fund.slug}`}
              className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-heading-sm text-fg">{view.fund.name}</span>
                <Sparkline values={carryForward(view.points).map((p) => p.value)} width={72} />
              </span>

              <MoneyValue value={view.value} size="display-sm" cents="muted" />

              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {view.absReturn !== null && (
                  <DeltaBadge value={view.absReturn} context="return since inception" />
                )}
                <span className="num text-caption text-fg-muted">
                  {formatEur(view.deposited)} deposited
                </span>
              </span>

              <StaleBadge capturedAt={view.capturedAt} stale={view.stale} />
            </Link>
          ))}
        </div>
      )}

      {funds.length > 0 && <MonthlyGainPanel gain={gain} />}
    </main>
  );
}
