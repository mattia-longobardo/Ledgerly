import { Panel } from "@/components/layout/PageGrid";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { cn } from "@/components/ui/cn";
import { formatDelta, formatEur, formatMonth, formatPercent } from "@/lib/format";
import type { GainRow, PerFundGain } from "@/lib/calc/portfolio";
import type { PortfolioGain } from "../_lib/gain";

/** Sign is carried by the glyph in `formatDelta`/`formatPercent`; colour only reinforces it. */
function tone(value: number | null): string {
  if (value === null || value === 0) return "text-fg-muted";
  return value > 0 ? "text-positive" : "text-negative";
}

function Pct({ value }: { value: number | null }) {
  return <span className={cn("num", tone(value))}>{formatPercent(value, { signed: true })}</span>;
}

/**
 * A rule under every single row turns a table into a ladder and nothing groups.
 * The rows are chunked by calendar year instead, and only the seam between two
 * years carries a rule, so the eye gets a structure rather than a stripe count.
 */
function byYear(rows: readonly GainRow[]): { year: string; rows: GainRow[] }[] {
  const groups: { year: string; rows: GainRow[] }[] = [];
  for (const row of rows) {
    const year = row.month.slice(0, 4);
    const last = groups.at(-1);
    if (last !== undefined && last.year === year) last.rows.push(row);
    else groups.push({ year, rows: [row] });
  }
  return groups;
}

const CELL = "px-3 py-1.5 text-right whitespace-nowrap";

/** One fund's months: paid in, monthly return, and the euro gain that sums to its card. */
function FundTable({ fund }: { fund: PerFundGain }) {
  if (fund.rows.length === 0) return null;
  const groups = byYear(fund.rows);

  return (
    <div className="overflow-x-auto rounded-md border border-border bg-surface">
      <table className="w-full border-collapse text-body-sm">
        <caption className="px-3 pt-3 pb-1 text-left text-heading-sm text-fg">
          {fund.label}
        </caption>
        <thead>
          <tr className="hairline-b text-caption text-fg-muted">
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Month
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Paid in
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Return
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Gain
            </th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.year} className="hairline-b last:border-b-0">
            {group.rows.map((row) => (
              <tr key={row.month}>
                <th
                  scope="row"
                  className="px-3 py-1.5 text-left font-normal whitespace-nowrap text-fg"
                >
                  {formatMonth(row.month)}
                  {row.opening && <span className="ml-1.5 text-caption text-fg-muted">opening</span>}
                </th>
                <td className={cn("num text-fg-muted", CELL)}>
                  {row.paidIn > 0 ? formatEur(row.paidIn) : "-"}
                </td>
                <td className={CELL}>
                  {row.opening ? <span className="text-fg-muted">-</span> : <Pct value={row.pct} />}
                </td>
                <td className={cn("num", CELL, row.opening ? "text-fg-muted" : tone(row.abs))}>
                  {formatDelta(row.abs)}
                </td>
              </tr>
            ))}
          </tbody>
        ))}
        <tfoot>
          <tr className="hairline-t bg-surface-raised">
            <th scope="row" className="px-3 py-2 text-left font-medium text-fg">
              Since {formatMonth(fund.rows[0]!.month)}
            </th>
            <td className={cn("num text-fg-muted", CELL, "py-2")}>
              {formatEur(Number(fund.rows.reduce((s, r) => s + r.paidIn, 0).toFixed(2)))}
            </td>
            <td className={cn(CELL, "py-2")}>
              <Pct value={fund.total.pct} />
            </td>
            <td className={cn("num", CELL, "py-2", tone(fund.total.abs))}>
              {formatDelta(fund.total.abs)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * Month-by-month return on the money actually invested, one table per fund plus
 * a combined total.
 *
 * Each fund's euro column reconciles with its card: every month reports the
 * change in cumulative gain (`value change − paid in`), so the column sums to
 * the fund's lifetime absolute gain shown on the card, and the two funds add up
 * to the combined total. The first funded month is an "opening" baseline — the
 * position established, not a scored return — so its percentage is blank.
 */
export function MonthlyGainPanel({ gain }: { gain: PortfolioGain }) {
  if (gain.error) {
    return (
      <Panel span={12} title="Monthly return">
        <p className="max-w-prose text-body-sm text-fg-muted">
          The return history could not be read just now. The balances above come from Postgres and
          are unaffected.
        </p>
      </Panel>
    );
  }

  const withRows = gain.perFund.filter((f) => f.rows.length > 0);
  if (withRows.length === 0) return null;

  const combinedPaidIn = Number(gain.combined.reduce((s, r) => s + r.paidIn, 0).toFixed(2));

  return (
    <Panel
      span={12}
      title="Monthly return"
      action={
        <DeltaBadge
          value={gain.combinedTotal.abs}
          percent={gain.combinedTotal.pct}
          context="total gain across both funds, matching the fund cards"
        />
      }
    >
      <p className="max-w-prose text-body-sm text-fg-muted">
        Each month&rsquo;s gain is the change in value less the money paid in, so every fund&rsquo;s
        euro column adds up to the total gain on its card. Cometa pays in quarterly and a recorded
        value describes the month before it, so each contribution counts from the month it first
        shows up; the &ldquo;opening&rdquo; row is the position first established, not a return.
      </p>

      <div className="@container mt-4 grid gap-4 @3xl:grid-cols-2">
        {withRows.map((fund) => (
          <FundTable key={fund.key} fund={fund} />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-raised px-3 py-2">
        <span className="text-body-sm font-medium text-fg">Both funds together</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="num text-caption text-fg-muted">{formatEur(combinedPaidIn)} paid in</span>
          <DeltaBadge
            value={gain.combinedTotal.abs}
            percent={gain.combinedTotal.pct}
            context="combined gain"
          />
        </span>
      </div>

      {gain.cometaFees > 0 && (
        <p className="max-w-prose pt-3 text-caption text-fg-muted">
          Cometa has deducted <span className="num">{formatEur(gain.cometaFees)}</span> in costs:
          &euro;1 a month, taken &euro;3 at a time with each quarterly credit, plus the one-off
          joining fee. Costs are held out of the invested capital, never counted as a loss.
        </p>
      )}
    </Panel>
  );
}
