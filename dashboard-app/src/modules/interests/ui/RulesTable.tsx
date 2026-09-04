"use client";

import Link from "next/link";
import type { RuleRow } from "./load-interests";

export interface RulesTableProps {
  rows: readonly RuleRow[];
}

const POSTING_LABEL: Record<string, string> = {
  analyze_only: "Analyse only",
  post_to_provider: "Posts to Wallet",
};

/** Rate strings are plain decimals (e.g. "0.0225" for 2.25%), never pre-formatted percentages. */
function asPercent(rate: string): string {
  return `${(Number(rate) * 100).toFixed(2)}%`;
}

export function RulesTable({ rows }: RulesTableProps) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-body-sm text-fg-muted">No interest rules yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body-sm">
        <thead>
          <tr className="text-left text-fg-muted">
            <th className="py-2 font-normal">Account</th>
            <th className="font-normal">Annual rate</th>
            <th className="font-normal">Tax rate</th>
            <th className="font-normal">Posting</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="hairline-t">
              <td className="py-2">
                <Link
                  href={`/finance/interests/rules/${r.id}`}
                  className="num text-fg underline-offset-2 hover:underline"
                >
                  {r.accountId}
                </Link>
              </td>
              <td>{asPercent(r.annualRate)}</td>
              <td>{asPercent(r.taxRate)}</td>
              <td className={r.postingMode === "post_to_provider" ? "text-fg" : "text-fg-muted"}>
                {POSTING_LABEL[r.postingMode] ?? r.postingMode}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
