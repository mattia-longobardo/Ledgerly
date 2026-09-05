"use client";

import { MoneyValue } from "@/components/ui/MoneyValue";
import type { RuleDetailAccrual, RuleDetailProjectionPoint } from "./load-interests";

export interface RuleDetailProps {
  accruals: readonly RuleDetailAccrual[];
  reconciliationStatus: string;
  projection: readonly RuleDetailProjectionPoint[];
  /**
   * Ruling P3-C44 (B6): true for a rule whose `dayCount`/`compounding` mean
   * the accrual job will never compute anything for it — see
   * `RuleRow.inert` in `load-interests.ts`. Optional and defaults to
   * unset/`false` so an existing caller that has not been updated to pass it
   * keeps behaving exactly as before; the page under `src/app/` that renders
   * this component already has `detail.rule.inert` available and should
   * pass it through as `ruleInert`.
   */
  ruleInert?: boolean;
}

/**
 * `no_data` reads nothing like `matched` on purpose: an empty accrual period
 * means the job hasn't produced records yet, which is a different fact from
 * "compared, and the books agree." Collapsing the two into one "OK"-shaped
 * message would be a confident claim made from zero evidence.
 *
 * `indeterminate` (Ruling P3-C39, B2) means at least one accrual in this
 * period is claimed-but-unconfirmed — `postedAt` set, `entryId` still null —
 * the observable signature of a crash between a successful Wallet POST and
 * the local confirm write. It is neither "posted" nor "unposted" and must
 * not read as either.
 */
const RECONCILIATION_COPY: Record<string, string> = {
  matched: "Matched — accrued and paid amounts agree for this period.",
  missing: "Missing — interest has accrued but nothing has posted yet.",
  delayed: "Delayed — less has posted so far than has accrued.",
  anomalous: "Anomalous — the posted amount does not match what accrued.",
  no_data: "No data yet — the accrual job has not produced records for this period.",
  indeterminate:
    "Indeterminate — a posting attempt did not finish cleanly. Money may already be at Wallet; verify manually before this rule posts again.",
};

export function RuleDetail({ accruals, reconciliationStatus, projection, ruleInert }: RuleDetailProps) {
  return (
    <div className="flex flex-col gap-6">
      {ruleInert ? (
        <p className="text-body-sm text-fg-muted">
          This rule&apos;s settings mean it never accrues: only daily-simple compounding over a fixed
          360/365-day count is computed. It will list and show an empty projection, but the accrual job
          skips it by construction, every day, until its compounding or day count is changed.
        </p>
      ) : null}
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
