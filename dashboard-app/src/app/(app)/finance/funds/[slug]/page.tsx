import Link from "next/link";
import { notFound } from "next/navigation";
import { TimeSeriesChart } from "@/components/chart/TimeSeriesChart";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { StaleBadge } from "@/components/ui/StaleBadge";
import { returnTable } from "@/lib/calc/funds";
import type { Series } from "@/lib/contracts";
import { formatDelta, formatEur, formatMonth, formatPercent } from "@/lib/format";
import { monthKey } from "@/lib/time";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { loadFund } from "../../_lib/funds";
import { FundSettingsForm } from "./_components/FundSettingsForm";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: slug };
}

export default async function FundDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requireUserOrRedirect(`/finance/funds/${slug}`);

  const view = await loadFund(slug);
  if (view === null) notFound();

  const now = monthKey(new Date());
  const rows = returnTable(view.settings, view.deposits, view.points, "ALL", {
    earliest: view.earliestMonth,
  });
  const table = [...rows].reverse();

  const series: Series[] = [
    { key: "value", label: "Value", points: rows.map((r) => ({ month: r.month, value: r.value })) },
    {
      key: "deposited",
      label: "Deposited",
      points: rows.map((r) => ({ month: r.month, value: r.deposited })),
    },
  ];

  const effective = view.effective;

  return (
    <>
      <PageHeader
        title={view.fund.name}
        eyebrow={
          <Link href="/finance/funds" className="text-fg-muted transition-colors hover:text-fg">
            &larr; Funds
          </Link>
        }
      />

      <PageGrid className="pt-5">
        {/* The read and the curve that explains it, on one panel. */}
        <Panel span={7} ariaLabel={`${view.fund.name} value`}>
          <div className="axis-rule-live pb-6">
            <MoneyValue value={view.value} size="display" cents="muted" />
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              {view.absReturn !== null && (
                <DeltaBadge value={view.absReturn} context="return since inception" />
              )}
              <span className="num text-caption text-fg-muted">
                {formatEur(view.deposited)} deposited
              </span>
              <StaleBadge capturedAt={view.capturedAt} stale={view.stale} />
            </div>
          </div>

          <h2 className="mt-5 text-caption tracking-wide text-fg-muted uppercase">
            Deposited versus value
          </h2>
          <TimeSeriesChart
            series={series}
            label={`${view.fund.name}: deposited versus value by month`}
            height={320}
            area={false}
            className="mt-3"
          />
        </Panel>

        {/* Controls, not filler prose: the one legitimate place for a framed
            panel on this screen is the block you type into. */}
        <Panel span={5} title="Settings" chrome="framed">
          <FundSettingsForm
            fundId={view.fund.id}
            fundName={view.fund.name}
            effectiveFrom={(effective?.effectiveFrom ?? now).slice(0, 7)}
            initialCapital={effective?.initialCapital ?? "0"}
            depositMode={effective?.depositMode === "payroll" ? "payroll" : "fixed"}
            fixedMonthlyAmount={effective?.fixedMonthlyAmount ?? ""}
            currentMonth={now.slice(0, 7)}
          />
        </Panel>

        <Panel span={7} title="Monthly return">
          {table.length === 0 ? (
            <p className="text-body-sm text-fg-muted">Not enough history yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-72 border-collapse">
                <thead>
                  <tr className="hairline-b">
                    <th
                      scope="col"
                      className="py-2 pr-3 text-left text-caption tracking-wide text-fg-muted uppercase"
                    >
                      Month
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2 text-right text-caption tracking-wide text-fg-muted uppercase"
                    >
                      &Delta; &euro;
                    </th>
                    <th
                      scope="col"
                      className="py-2 pl-3 text-right text-caption tracking-wide text-fg-muted uppercase"
                    >
                      &Delta; %
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {table.map((row) => (
                    <tr key={row.month} className="hairline-b">
                      <th
                        scope="row"
                        className="num py-1.5 pr-3 text-left text-body-sm font-normal text-fg"
                      >
                        {formatMonth(row.month)}
                      </th>
                      <td className={cellTone(row.monthAbs, "num px-3 py-1.5 text-right text-body-sm")}>
                        {formatDelta(row.monthAbs)}
                      </td>
                      <td
                        className={cellTone(row.monthPct, "num py-1.5 pl-3 text-right text-body-sm")}
                      >
                        {formatPercent(row.monthPct, { signed: true })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </PageGrid>
    </>
  );
}

/** Sign is carried by the glyph in `formatDelta`; colour only reinforces it. */
function cellTone(value: number | null, base: string): string {
  if (value === null || value === 0) return `${base} text-fg-muted`;
  return `${base} ${value > 0 ? "text-positive" : "text-negative"}`;
}
