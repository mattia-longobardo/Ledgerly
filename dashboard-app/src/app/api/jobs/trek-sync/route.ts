import { verifyCronSecret } from "@/lib/auth/machine";
import { runTrekSyncJob } from "@/lib/jobs/trek-sync-job";

export const dynamic = "force-dynamic";

/**
 * Hourly supercronic target, :23 — clear of the sweep at :07.
 *
 * The sync is bidirectional, so the schedule is what makes a change made in
 * Trek show up here: Trek broadcasts entry changes over a websocket only, and
 * has no outbound webhook for them, so polling is the only pull signal.
 *
 * 500 only on `failed`, matching the other machine endpoints: `already_done`
 * — an unconfigured install, or a retry that lost the lock — is a correct
 * outcome and must not make `curl --retry` hammer it.
 */
export async function POST(req: Request) {
  const denied = verifyCronSecret(req);
  if (denied) return denied;

  const result = await runTrekSyncJob({ trigger: "cron" });
  return Response.json(result, { status: result.status === "failed" ? 500 : 200 });
}
