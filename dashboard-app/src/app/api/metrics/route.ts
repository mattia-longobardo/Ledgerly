import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Prometheus text exposition. Scraped over the internal network only; carries
 * job freshness so Grafana can alert when a scheduled job stops succeeding.
 */
export async function GET() {
  const lastSuccess = await db.execute<{ job: string; ts: string | null }>(sql`
    SELECT job_name AS job,
           extract(epoch FROM max(started_at))::text AS ts
    FROM job_runs
    WHERE status IN ('success','success_after_retry','already_done')
    GROUP BY job_name
  `);

  const totals = await db.execute<{ job: string; status: string; n: string }>(sql`
    SELECT job_name AS job, status, count(*)::text AS n
    FROM job_runs GROUP BY job_name, status
  `);

  /**
   * The legacy `payslips` table this gauge used to count was dropped in
   * `0018` (R7-5'). `payroll_imports` carries the review queue now, so the
   * gauge counts the same statuses the queue itself is built from
   * (`AWAITING_STATUSES` in `src/modules/payroll/ui/queue.ts`) — the number a
   * reviewer sees when they follow the alert.
   */
  const pending = await db.execute<{ n: string }>(sql`
    SELECT count(*)::text AS n FROM payroll_imports
    WHERE status IN ('needs_review','verified','needs_ocr')
  `);

  const lines: string[] = [
    "# HELP job_last_success_timestamp Unix time of the last successful run.",
    "# TYPE job_last_success_timestamp gauge",
    ...lastSuccess.rows.map((r) => `job_last_success_timestamp{job="${r.job}"} ${r.ts ?? 0}`),
    "# HELP job_runs_total Job invocations by terminal status.",
    "# TYPE job_runs_total counter",
    ...totals.rows.map((r) => `job_runs_total{job="${r.job}",status="${r.status}"} ${r.n}`),
    "# HELP payslips_pending_verification Payslip imports awaiting the human gate.",
    "# TYPE payslips_pending_verification gauge",
    `payslips_pending_verification ${pending.rows[0]?.n ?? 0}`,
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
  });
}
