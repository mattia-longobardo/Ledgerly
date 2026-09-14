import { sql } from "drizzle-orm";
import { getDb } from "@/platform/db/client";

export const dynamic = "force-dynamic";

/** Prometheus text format for the homelab's Prometheus/Grafana (spec §10.4). */
export async function GET() {
  // `pg` returns bigint columns as strings; the value is printed as is.
  const lastSuccess = await getDb().execute<{ job: string; ts: string }>(
    sql`SELECT job, extract(epoch FROM max(finished_at))::bigint AS ts FROM job_runs WHERE status = 'success' GROUP BY job ORDER BY job`,
  );
  const totals = await getDb().execute<{ job: string; status: string; n: number }>(
    sql`SELECT job, status, count(*)::int AS n FROM job_runs GROUP BY job, status ORDER BY job, status`,
  );
  const lines = [
    "# TYPE job_last_success_timestamp gauge",
    ...lastSuccess.rows.map((r) => `job_last_success_timestamp{job="${r.job}"} ${r.ts}`),
    "# TYPE job_runs_total counter",
    ...totals.rows.map((r) => `job_runs_total{job="${r.job}",status="${r.status}"} ${r.n}`),
  ];
  return new Response(`${lines.join("\n")}\n`, { headers: { "Content-Type": "text/plain; version=0.0.4" } });
}
