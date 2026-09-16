import { sql } from "drizzle-orm";
import { getDb } from "@/platform/db/client";
import { readEnv } from "@/platform/env";
import { secretMatches } from "@/platform/jobs/secret";

export const dynamic = "force-dynamic";

function bearerToken(header: string | null): string | null {
  const match = header?.match(/^Bearer (.+)$/);
  return match ? match[1] : null;
}

/**
 * Prometheus text format for the homelab's Prometheus/Grafana (spec §10.4). The scrape target is
 * the `ledgerly` service on the compose network (spec §13); the app itself is reached only
 * over LAN/NetBird, but this endpoint must still never serve unauthenticated: a missing
 * `METRICS_TOKEN` (dev/test without it configured) or any failed check is a bare 404, matching
 * `/api/jobs/tick`'s behaviour, so the endpoint reveals nothing either way.
 */
export async function GET(request: Request) {
  const expected = readEnv().METRICS_TOKEN;
  if (!expected || !secretMatches(bearerToken(request.headers.get("authorization")), expected)) {
    return new Response(null, { status: 404 });
  }
  // `pg` returns bigint columns as strings; the value is printed as is.
  const lastSuccess = await getDb().execute<{ job: string; ts: string }>(
    sql`SELECT job, extract(epoch FROM max(finished_at))::bigint AS ts FROM job_runs WHERE status = 'success' GROUP BY job ORDER BY job`,
  );
  // `running` is a live, in-flight state, never a retained outcome: `job_runs_total` counts only
  // rows housekeeping has not yet pruned (90-day retention, src/platform/jobs/housekeeping.ts).
  const totals = await getDb().execute<{ job: string; status: string; n: number }>(
    sql`SELECT job, status, count(*)::int AS n FROM job_runs WHERE status != 'running' GROUP BY job, status ORDER BY job, status`,
  );
  const lines = [
    "# TYPE job_last_success_timestamp gauge",
    ...lastSuccess.rows.map((r) => `job_last_success_timestamp{job="${r.job}"} ${r.ts}`),
    "# TYPE job_runs_total counter",
    ...totals.rows.map((r) => `job_runs_total{job="${r.job}",status="${r.status}"} ${r.n}`),
  ];
  return new Response(`${lines.join("\n")}\n`, { headers: { "Content-Type": "text/plain; version=0.0.4" } });
}
