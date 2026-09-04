"use client";

import { MoneyValue } from "@/components/ui/MoneyValue";
import type { RuleDetailAccrual, RuleDetailProjectionPoint } from "./load-interests";

export interface RuleDetailProps {
  accruals: readonly RuleDetailAccrual[];
  reconciliationStatus: string;
  projection: readonly RuleDetailProjectionPoint[];
}

/**
 * `no_data` reads nothing like `matched` on purpose: an empty accrual period
 * means the job hasn't produced records yet, which is a different fact from
 * "compared, and the books agree." Collapsing the two into one "OK"-shaped
 * message would be a confident claim made from zero evidence.
 */
const RECONCILIATION_COPY: Record<string, string> = {
  matched: "Matched — accrued and paid amounts agree for this period.",
  missing: "Missing — interest has accrued but nothing has posted yet.",
  delayed: "Delayed — less has posted so far than has accrued.",
  anomalous: "Anomalous — the posted amount does not match what accrued.",
  no_data: "No data yet — the accrual job has not produced records for this period.",
};

export function RuleDetail({ accruals, reconciliationStatus, projection }: RuleDetailProps) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-body-sm text-fg">
        {RECONCILIATION_COPY[reconciliationStatus] ?? reconciliationStatus}
      </p>

      <div>
        <h2 className="text-body-sm font-medium text-fg-muted">Accrued this period</h2>
        {accruals.length === 0 ? (
          <p className="mt-2 text-body-sm text-fg-muted">No accrual recorded for this period yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-body-sm">
            {accruals.map((a) => (
              <li key={a.accrualDate} className="flex justify-between">
                <span className="text-fg-muted">{a.accrualDate}</span>
                <MoneyValue value={a.net} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="text-body-sm font-medium text-fg-muted">
          Projected (next 30 days, current balance held constant)
        </h2>
        {projection.length === 0 ? (
          <p className="mt-2 text-body-sm text-fg-muted">
            No projection available — either there is no balance on file for this account, or this rule
            does not compound daily.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-body-sm">
            {projection.slice(0, 5).map((p) => (
              <li key={p.date} className="flex justify-between">
                <span className="text-fg-muted">{p.date}</span>
                <MoneyValue value={p.net} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
