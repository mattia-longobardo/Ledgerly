import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { formatMonth } from "@/lib/format";
import type { EarningsRow } from "./load-company";

const KIND_LABEL: Record<string, string> = {
  ordinary: "",
  thirteenth: "13th month",
  fourteenth: "14th",
  bonus: "Bonus",
  settlement: "Settlement",
};

export interface EarningsTableProps {
  rows: readonly EarningsRow[];
}

export function EarningsTable({ rows }: EarningsTableProps) {
  if (rows.length === 0) {
    return (
      <div className="max-w-xl">
        <EmptyState
          title="No earnings yet"
          description="Earnings appear once a payslip has been confirmed and applied."
          action={
            <Link
              href="/company/payroll"
              className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
            >
              Go to Payroll
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <ul className="hairline-t">
      {rows.map((row) => (
        <li key={row.id} className="lazy-block [contain-intrinsic-size:auto_4rem]">
          <Link
            href={`/company/earnings/${row.id}`}
            className="flex min-h-11 items-center gap-3 py-2 hairline-b transition-colors hover:bg-surface-hover"
          >
            <span className="min-w-0 flex-1">
              <span className="num block text-body text-fg">
                {formatMonth(row.periodStart)}
                {KIND_LABEL[row.kind] && <span className="ml-2 text-caption text-fg-muted">{KIND_LABEL[row.kind]}</span>}
              </span>
              <span className="num mt-0.5 block text-caption text-fg-muted">
                {/* An em dash, never €0.00, for a figure the payslip did not state. */}
                Gross <MoneyValue value={row.gross} size="body" /> · Taxes <MoneyValue value={row.taxes} size="body" />
              </span>
            </span>
            <MoneyValue value={row.net} size="body" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
