/**
 * The Trek pass (spec §9.2), at the time the person chose (docs/auth-design.md D7). The dispatcher
 * is the scheduler, not the engine: the engine is the port `LeaveCalendarSync` of time off (TOF-1),
 * realised by Trek's integration, which writes `sync_runs` and keeps one pass per user.
 *
 * Nothing here sends mail. A pass that fails at this cadence would mail once an hour, and the
 * condition it reports — two calendars that have drifted apart — is one the staleness badge in
 * Settings › Integrations already shows (plan F7 §3.4.11). A user with no Trek connection is not a
 * failure and not a skipped pass: there is simply nothing to ask.
 */
import "server-only";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { redactForLog } from "@ledgerly/domain/platform/auth";
import { calendarSync } from "@ledgerly/domain/timeoff";

/** What became of one Trek pass, as the integrations dispatcher counts it. */
type TrekPassOutcome = "answered" | "failed" | "refused" | "busy" | "absent";

/**
 * One Trek pass for one person, when the connection's own schedule says it is due (D7). Called by
 * the integrations dispatcher (`platform/integrations/jobs.ts`), which took over from `trek-sync`.
 */
export async function runTrekPass(ctx: Ctx): Promise<TrekPassOutcome> {
  const calendar = calendarSync();
  try {
    const result = await calendar.passNow(ctx);
    if (result === null) return "absent"; // no Trek link: nothing to do, and nothing to report
    return result.refused === null ? "answered" : "refused";
  } catch (error) {
    // "Sync now" pressed as the tick came round is not a failure: nothing was attempted.
    if (calendar.isBusy(error)) return "busy";
    console.error("[integrations-sync] the Trek pass failed", redactForLog(error));
    return "failed";
  }
}
