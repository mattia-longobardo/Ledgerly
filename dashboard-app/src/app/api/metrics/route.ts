import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withSystemContext } from "@/platform/db/context";

export const dynamic = "force-dynamic";

/**
 * Prometheus text exposition. Scraped over the internal network only; carries
 * job freshness so Grafana can alert when a scheduled job stops succeeding.
 *
 * The reads run inside `withSystemContext`: this endpoint counts across every
 * user and has no principal of its own, and `payroll_imports` carries FORCE
 * ROW LEVEL SECURITY. On the bare pool its owner policy admits nothing — with
 * no session GUC set both `app_is_system()` and `app_current_user_id()` are
 * NULL — so the gauge would report 0 for ever, silently. The single
 * transaction also gives all three queries the same snapshot.
 */
export async function GET() {
  const { lastSuccess, totals, pending } = await withSystemContext(db, async (tx) => {
    const lastSuccess = await tx.execute<{ job: string; ts: string | null }>(sql`
      SELECT job_name AS job,
             extract(epoch FROM max(started_at))::text AS ts
      FROM job_runs
      WHERE status IN ('success','success_after_retry','already_done')
      GROUP BY job_name
    `);

    const totals = await tx.execute<{ job: string; status: string; n: string }>(sql`
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
    const pending = await tx.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM payroll_imports
      WHERE status IN ('needs_review','verified','needs_ocr')
    `);

    return { lastSuccess, totals, pending };
  });

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
