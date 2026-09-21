/**
 * The hourly Trek pass (spec §10.2, §9.2). The job is the scheduler, not the engine: the engine is
 * `platform/integrations/trek/sync.ts`, which writes `sync_runs` and keeps one pass per user.
 *
 * Nothing here sends mail. A pass that fails at this cadence would mail once an hour, and the
 * condition it reports — two calendars that have drifted apart — is one the staleness badge in
 * Settings › Integrations already shows (plan F7 §3.4.11). A user with no Trek connection is not a
 * failure and not a skipped pass: there is simply nothing to ask.
 */
import "server-only";
import { forEachUser } from "@/modules/users/jobs";
import { redactForLog } from "@/platform/auth/logger";
import { isTrekBusy, syncTrekNow } from "@/platform/integrations/trek/sync";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@/platform/jobs/schema";

export const trekSyncJob: JobDefinition = {
  name: "trek-sync",
  tier: "hourly",
  async run(): Promise<JobDetail> {
    let connections = 0;
    let passes = 0;
    let failures = 0;
    let refused = 0;
    let busy = 0;
    let applied = 0;
    let adopted = 0;
    let unsettled = 0;
    let conflicts = 0;

    const counts = await forEachUser("trek-sync", async (_person, ctx) => {
      try {
        const result = await syncTrekNow(ctx);
        if (result === null) return; // no Trek link: nothing to do, and nothing to report
        connections += 1;
        if (result.refused !== null) {
          refused += 1;
          return;
        }
        passes += 1;
        applied += result.counts.applied ?? 0;
        adopted += result.counts.adopted ?? 0;
        unsettled += result.counts.unsettled ?? 0;
        conflicts += result.conflicts.length;
      } catch (error) {
        // "Sync now" pressed as the tick came round is not a failure: nothing was attempted.
        if (isTrekBusy(error)) {
          busy += 1;
          return;
        }
        connections += 1;
        failures += 1;
        console.error("[trek-sync] the Trek pass failed", redactForLog(error));
      }
    });

    return {
      ...counts,
      connections,
      passes,
      failures,
      refused,
      busy,
      applied,
      adopted,
      unsettled,
      conflicts,
    };
  },
};
