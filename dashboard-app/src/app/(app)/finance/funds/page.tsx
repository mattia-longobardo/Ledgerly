import Link from "next/link";
import { Sparkline } from "@/components/chart/Sparkline";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
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
    <>
      <PageHeader
        title="Funds"
        segmented={<FinanceTabs />}
        action={
          <Link
            href="/finance/vacation"
            className="text-body-sm text-accent transition-colors hover:text-accent-hover"
          >
            Vacation fund &rarr;
          </Link>
        }
      />

      {funds.length === 0 ? (
        <div className="max-w-xl pt-6">
          <EmptyState
            title="No funds registered"
            description="Fideuram and Fondo Cometa are seeded by the database migration. If this is empty, the migration has not run yet."
          />
        </div>
      ) : (
        <PageGrid className="pt-5">
          <Panel span={12} ariaLabel="Funds">
            {/*
              The card count steps on the PANEL's width, not the viewport's, so
              this same grid is 1-up in a sidebar and 4-up across a 1920 row
              without the page telling it which it is.
            */}
            <div className="@container grid gap-4 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4">
              {funds.map((view) => (
                <Link
                  key={view.fund.id}
                  href={`/finance/funds/${view.fund.slug}`}
                  className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4 transition-colors hover:bg-surface-hover"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-heading-sm text-fg">
                      {view.fund.name}
                    </span>
                    <Sparkline
                      values={carryForward(view.points).map((p) => p.value)}
                      width={72}
                    />
                  </span>

                  <MoneyValue
                    value={view.value}
                    size="display-sm"
                    cents="muted"
                  />

                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {view.absReturn !== null && (
                      <DeltaBadge
                        value={view.absReturn}
                        context="return since inception"
                      />
                    )}
                    <span className="num text-caption text-fg-muted">
                      {formatEur(view.deposited)} deposited
                    </span>
                  </span>

                  <StaleBadge capturedAt={view.capturedAt} stale={view.stale} />
                </Link>
              ))}
            </div>
          </Panel>

          <MonthlyGainPanel gain={gain} />
        </PageGrid>
      )}
    </>
  );
}
