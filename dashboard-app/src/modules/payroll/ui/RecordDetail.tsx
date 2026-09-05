import Link from "next/link";
import { Panel } from "@/components/layout/PageGrid";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { formatNumber } from "@/lib/format";
import type { RecordDetailData } from "./load-company";

const KIND_LABEL: Record<string, string> = {
  earning: "Earning",
  deduction: "Deduction",
  tax: "Tax",
  employer_contribution: "Employer contribution",
  employee_contribution: "Employee contribution",
  reimbursement: "Reimbursement",
  allowance: "Allowance",
  bonus: "Bonus",
  leave_balance: "Leave balance",
  leave_used: "Leave used",
  leave_accrued: "Leave accrued",
  info: "Information",
};

export interface RecordDetailProps {
  detail: RecordDetailData;
}

export function RecordDetail({ detail }: RecordDetailProps) {
  return (
    <Panel span={12} title="Components">
      <ul className="hairline-t">
        {detail.components.map((component) => (
          <li key={component.id} className="flex min-h-11 items-center gap-3 py-2 hairline-b">
            <span className="min-w-0 flex-1">
              {/* The payslip's own Italian wording, verbatim (spec §2.9): it is
                  what the reader compares against the document in their hand.
                  Everything around it is English. */}
              <span className="block text-body text-fg">{component.labelRaw}</span>
              <span className="mt-0.5 block text-caption text-fg-muted">
                {KIND_LABEL[component.kind] ?? component.kind}
                {component.confidence && ` · ${component.confidence} confidence`}
                {` · from ${component.source}`}
              </span>
            </span>
            {component.amount !== null ? (
              <MoneyValue value={component.amount} size="body" />
            ) : (
              <span className="num text-body text-fg">
                {component.quantity === null ? "—" : `${formatNumber(Number(component.quantity))} ${component.unit ?? ""}`}
              </span>
            )}
          </li>
        ))}
      </ul>

      <p className="pt-4 text-body-sm text-fg-muted">
        {detail.canReadOriginal && detail.originalAvailable ? (
          <Link className="underline" href={`/api/v1/payroll/imports/${detail.importId}/original`}>
            Open the original payslip
          </Link>
        ) : detail.canReadOriginal ? (
          "The original has been removed under the retention policy."
        ) : (
          "You do not have permission to open the original."
        )}
      </p>
    </Panel>
  );
}
