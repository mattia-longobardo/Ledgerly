import Link from "next/link";
import { notFound } from "next/navigation";
import { TimeSeriesChart } from "@/components/chart/TimeSeriesChart";
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
    <main className="pb-8">
      <PageHeader
        title={view.fund.name}
        eyebrow={
          <Link href="/finance/funds" className="text-fg-muted">
            ← Funds
          </Link>
        }
      />

      <div className="px-4">
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

      {/* Desktop: chart left, table right. Mobile: stacked, chart first. */}
      <div className="mt-6 lg:grid lg:grid-cols-2 lg:gap-6 lg:px-4">
        <section className="px-4 lg:px-0">
          <h2 className="text-caption tracking-wide text-fg-muted uppercase">
            Deposited vs value
          </h2>
          <TimeSeriesChart
            series={series}
            label={`${view.fund.name}: deposited versus value by month`}
            height={200}
            area={false}
            className="mt-2"
          />
        </section>

        <section className="mt-6 lg:mt-0">
          <h2 className="px-4 text-caption tracking-wide text-fg-muted uppercase lg:px-0">
            Monthly return
          </h2>
          {table.length === 0 ? (
            <p className="px-4 pt-2 text-body-sm text-fg-muted lg:px-0">
              Not enough history yet.
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-72 border-collapse">
                <thead>
                  <tr className="hairline-b">
                    <th
                      scope="col"
                      className="px-4 py-2 text-left text-caption tracking-wide text-fg-muted uppercase lg:px-0"
                    >
                      Month
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2 text-right text-caption tracking-wide text-fg-muted uppercase"
                    >
                      Δ €
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2 text-right text-caption tracking-wide text-fg-muted uppercase lg:px-0"
                    >
                      Δ %
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {table.map((row) => (
                    <tr key={row.month} className="hairline-b">
                      <th
                        scope="row"
                        className="num px-4 py-2 text-left text-body-sm font-normal text-fg lg:px-0"
                      >
                        {formatMonth(row.month)}
                      </th>
                      <td
                        className={cellTone(row.monthAbs, "num px-4 py-2 text-right text-body-sm")}
                      >
                        {formatDelta(row.monthAbs)}
                      </td>
                      <td
                        className={cellTone(
                          row.monthPct,
                          "num px-4 py-2 text-right text-body-sm lg:px-0",
                        )}
                      >
                        {formatPercent(row.monthPct, { signed: true })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="mt-8 px-4">
        <h2 className="text-caption tracking-wide text-fg-muted uppercase">Settings</h2>
        <div className="mt-3">
          <FundSettingsForm
            fundId={view.fund.id}
            fundName={view.fund.name}
            effectiveFrom={(effective?.effectiveFrom ?? now).slice(0, 7)}
            initialCapital={effective?.initialCapital ?? "0"}
            depositMode={effective?.depositMode === "payroll" ? "payroll" : "fixed"}
            fixedMonthlyAmount={effective?.fixedMonthlyAmount ?? ""}
            currentMonth={now.slice(0, 7)}
          />
        </div>
      </section>
    </main>
  );
}

/** Sign is carried by the glyph in `formatDelta`; colour only reinforces it. */
function cellTone(value: number | null, base: string): string {
  if (value === null || value === 0) return `${base} text-fg-muted`;
  return `${base} ${value > 0 ? "text-positive" : "text-negative"}`;
}
