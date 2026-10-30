/**
 * `integrations-sync` (docs/scheduler.md): the one scheduled job behind every provider. It passes
 * each connection whose own `next_sync_at` has come, then moves that time on by the person's
 * schedule.
 *
 * The `minute` tier starts a pass within a minute of the time the person chose, and asks
 * {@link anyConnectionDue} first, so an idle minute leaves no trace. After the passes,
 * `runAfterSync` starts the jobs that read the movements, if a sync changed them.
 *
 * A pass that fails does not bring the next one forward: the provider's own `sync_runs` row and
 * the connection's health say what happened, and the schedule moves on as after a good pass. A
 * pass already running ("Sync now" as the tick came round) leaves the schedule alone, so the next
 * tick tries again.
 */
import "server-only";
import { contextFor, personById } from "@/modules/users/jobs";
import { redactForLog } from "@/platform/auth/logger";
import { runAfterSync } from "@/platform/jobs/after-sync";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@/platform/jobs/schema";
import { type PassOutcome, passFor } from "./registry";
import { advanceSchedule, anyConnectionDue, dueConnections } from "./service";

/**
 * One pass of the dispatcher at `now`: every connection due by then, each moved on by its own
 * schedule afterwards. Exported for the tests, which drive it minute by minute through a day.
 */
export async function dispatchDueConnections(now: Date): Promise<JobDetail> {
  const counts: Record<PassOutcome, number> = { answered: 0, failed: 0, refused: 0, busy: 0, absent: 0 };
  const byProvider: Record<string, number> = {};
  let errors = 0;

  for (const due of await dueConnections(now)) {
    try {
      const person = await personById(due.userId);
      if (!person) continue;
      const ctx = await contextFor(person);
      const pass = passFor(due.provider);
      const outcome: PassOutcome = pass ? await pass.run(person, ctx, due, now) : "absent";
      counts[outcome] += 1;
      byProvider[due.provider] = (byProvider[due.provider] ?? 0) + 1;
      if (outcome !== "busy") await advanceSchedule(ctx, due, now);
    } catch (error) {
      // One connection's trouble stays with that connection (spec §10.1).
      errors += 1;
      console.error("[integrations-sync] a connection could not be passed", redactForLog(error));
    }
  }

  // Once for the whole dispatch, so two connections due together start the checks once. It never
  // throws: a check that fails is recorded in `job_runs` and leaves this sync a success.
  const checks = await runAfterSync("minute");

  return {
    checks: checks.length,
    due: Object.values(counts).reduce((sum, value) => sum + value, 0) + errors,
    passes: counts.answered,
    failures: counts.failed + errors,
    refused: counts.refused,
    skipped: counts.busy,
    ...Object.fromEntries(Object.entries(byProvider).map(([provider, n]) => [`provider_${provider}`, n])),
  };
}

export const integrationsSyncJob: JobDefinition = {
  name: "integrations-sync",
  tier: "minute",
  hasWork: () => anyConnectionDue(),
  run: () => dispatchDueConnections(new Date()),
};
