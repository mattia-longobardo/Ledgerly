import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { cn } from "@/components/ui/cn";
import { formatMonth } from "@/lib/format";
import type { ImportRow } from "./load-payroll";
import { reviewHref } from "./queue";
import { statusChip } from "./status";

const TONE: Record<string, string> = {
  positive: "bg-positive/10 text-positive",
  warning: "bg-warning/10 text-warning",
  negative: "bg-negative/10 text-negative",
  neutral: "bg-surface text-fg-muted border border-border",
};

export interface ImportsTableProps {
  rows: readonly ImportRow[];
}

export function ImportsTable({ rows }: ImportsTableProps) {
  if (rows.length === 0) {
    return (
      <div className="max-w-xl">
        <EmptyState
          title="No payslips yet"
          description="Upload a payslip PDF and it will be scanned, read and put in front of you to confirm."
        />
      </div>
    );
  }

  return (
    <ul className="hairline-t">
      {rows.map((row) => {
        const chip = statusChip(row.status, row.scanStatus);
        return (
          <li key={row.id} className="lazy-block [contain-intrinsic-size:auto_4rem]">
            <Link
              href={reviewHref(row.id)}
              className="flex min-h-11 items-center gap-3 py-2 hairline-b transition-colors hover:bg-surface-hover"
            >
              <span className="min-w-0 flex-1">
                <span className="num block text-body text-fg">
                  {/* Never a placeholder date: an import the parser has not read yet
                      shows its filename, which is what the user recognises. */}
                  {row.month ? formatMonth(row.month) : row.fileName}
                </span>
                <span className={cn("mt-0.5 inline-flex rounded-xs px-1.5 py-0.5 text-caption", TONE[chip.tone])}>
                  {chip.label}
                </span>
              </span>
              {/* `null` renders as an em dash, never as €0.00. */}
              <MoneyValue value={row.net} size="body" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
