import { formatMonth } from "@/lib/format";
import type { FundContribution } from "../application/ports";
import type { QuarterRow } from "../domain/totals";
import { formatCurrency } from "./CurrencyValue";

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;
function cents(value: string): bigint {
  const match = DECIMAL.exec(value);
  if (!match) return 0n;
  return BigInt(`${match[1]}${match[2]}${((match[3] ?? "") + "00").slice(0, 2)}`);
}
function money(value: bigint): string {
  const negative = value < 0n;
  const absolute = (negative ? -value : value).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${absolute.slice(0, -2)}.${absolute.slice(-2)}`;
}

export function QuarterTable({ rows, currency, frequency }: { rows: readonly QuarterRow[]; currency: string; frequency: "quarterly" | "annual" }) {
  if (rows.length === 0) return <p className="py-5 text-body-sm text-fg-muted">No posting periods yet.</p>;
  return <div className="overflow-x-auto"><table className="w-full min-w-[38rem] border-collapse text-body-sm">
    <thead><tr className="hairline-b text-caption tracking-wide text-fg-muted uppercase"><th className="py-2 pr-3 text-left font-normal">{frequency === "annual" ? "Period" : "Quarter"}</th><th className="px-3 py-2 text-left font-normal">Posting month</th><th className="px-3 py-2 text-right font-normal">Gross</th><th className="px-3 py-2 text-right font-normal">Fees</th><th className="py-2 pl-3 text-right font-normal">Net</th></tr></thead>
    <tbody>{[...rows].reverse().map((row) => <tr key={`${row.accrualMonths[0]}-${row.postedMonth}`} className="hairline-b"><th scope="row" className="py-2 pr-3 text-left font-normal text-fg">{frequency === "annual" ? `${formatMonth(row.accrualMonths[0]!)} – ${formatMonth(row.accrualMonths.at(-1)!)} ` : row.quarter}</th><td className="px-3 py-2 text-fg-muted">{formatMonth(row.postedMonth)} · {row.posted ? "Posted" : "Pending posting"}</td><td className="num px-3 py-2 text-right text-fg">{formatCurrency(row.gross, currency)}</td><td className="num px-3 py-2 text-right text-fg">{formatCurrency(row.fees, currency)}</td><td className="num py-2 pl-3 text-right text-fg">{formatCurrency(row.net, currency)}</td></tr>)}</tbody>
  </table></div>;
}

export function MonthlyTable({ rows, currency }: { rows: readonly FundContribution[]; currency: string }) {
  const totals = new Map<string, bigint>();
  for (const row of rows) totals.set(row.postedMonth, (totals.get(row.postedMonth) ?? 0n) + cents(row.amount));
  const months = [...totals].sort(([a], [b]) => b.localeCompare(a));
  if (months.length === 0) return <p className="py-5 text-body-sm text-fg-muted">No monthly postings yet.</p>;
  return <div className="overflow-x-auto"><table className="w-full border-collapse text-body-sm"><thead><tr className="hairline-b text-caption tracking-wide text-fg-muted uppercase"><th className="py-2 pr-3 text-left font-normal">Month</th><th className="py-2 pl-3 text-right font-normal">Net posted</th></tr></thead><tbody>{months.map(([month, total]) => <tr key={month} className="hairline-b"><th scope="row" className="num py-2 pr-3 text-left font-normal text-fg">{formatMonth(month)}</th><td className="num py-2 pl-3 text-right text-fg">{formatCurrency(money(total), currency)}</td></tr>)}</tbody></table></div>;
}
