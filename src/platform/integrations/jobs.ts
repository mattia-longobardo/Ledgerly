/**
 * `integrations-sync` (docs/auth-design.md D7): the one scheduled job behind every provider. It
 * replaced `wallet-sync` and `trek-sync`: instead of every connection once an hour, it passes each
 * connection whose own `next_sync_at` has come, then moves that time on by the person's schedule.
 *
 * It runs in two tiers. `quarter` (:22, :37, :52) catches schedules off the hour; `hourly` (:07)
 * runs it **first**, so the jobs that read what a sync brought in — `recurrences-refresh`,
 * `subscriptions-check`, `budget-alerts`, `interests-accrual` — still see an on-the-hour pass,
 * exactly as they saw `wallet-sync`'s.
 *
 * A pass that fails does not bring the next one forward: the provider's own `sync_runs` row and
 * the connection's health say what happened, and the schedule moves on as after a good pass. A
 * pass already running ("Sync now" as the tick came round) leaves the schedule alone, so the next
 * tick tries again.
 */
import "server-only";
import { runTrekPass } from "@/modules/timeoff/jobs";
import { runWalletPass } from "@/modules/transactions/jobs";
import { contextFor, personById } from "@/modules/users/jobs";
import { redactForLog } from "@/platform/auth/logger";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@/platform/jobs/schema";
import { runPaperlessPass } from "./paperless/sync";
import { PAPERLESS_PROVIDER, TREK_PROVIDER, WALLET_PROVIDER } from "./rules";
import { advanceSchedule, type Connection, dueConnections, listConnections } from "./service";

type PassOutcome = "answered" | "failed" | "refused" | "busy" | "absent";

export const integrationsSyncJob: JobDefinition = {
  name: "integrations-sync",
  tier: "quarter",
  alsoIn: ["hourly"],
  async run(): Promise<JobDetail> {
    const now = new Date();
    const counts: Record<PassOutcome, number> = { answered: 0, failed: 0, refused: 0, busy: 0, absent: 0 };
    const byProvider: Record<string, number> = {};
    let errors = 0;

    for (const due of await dueConnections(now)) {
      try {
        const person = await personById(due.userId);
        if (!person) continue;
        const ctx = await contextFor(person);
        let outcome: PassOutcome;
        if (due.provider === WALLET_PROVIDER) {
          const connection = (await listConnections(ctx)).find((one) => one.id === due.id);
          outcome = connection ? await runWalletPass(person, ctx, connection as Connection, now) : "absent";
        } else if (due.provider === TREK_PROVIDER) {
          outcome = await runTrekPass(ctx);
        } else if (due.provider === PAPERLESS_PROVIDER) {
          outcome = await runPaperlessPass(ctx);
        } else {
          outcome = "absent";
        }
        counts[outcome] += 1;
        byProvider[due.provider] = (byProvider[due.provider] ?? 0) + 1;
        if (outcome !== "busy") await advanceSchedule(ctx, due, now);
      } catch (error) {
        // One connection's trouble stays with that connection (spec §10.1).
        errors += 1;
        console.error("[integrations-sync] a connection could not be passed", redactForLog(error));
      }
    }

    return {
      due: Object.values(counts).reduce((sum, value) => sum + value, 0) + errors,
      passes: counts.answered,
      failures: counts.failed + errors,
      refused: counts.refused,
      skipped: counts.busy,
      ...Object.fromEntries(Object.entries(byProvider).map(([provider, n]) => [`provider_${provider}`, n])),
    };
  },
};
