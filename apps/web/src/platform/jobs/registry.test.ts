import { describe, expect, it } from "vitest";
import { AFTER_SYNC_JOBS } from "./after-sync";
import { JOBS, runsIn, SCHEDULE } from "./registry";

/** The tiers the worker's scheduler starts: the table it reads, not a copy of it. */
function scheduledTiers(): Set<string> {
  return new Set(Object.keys(SCHEDULE));
}

/**
 * The registry is one line per phase and nothing else asserts its contents: `jobs.itest.ts` proves
 * `runTier` works by injecting synthetic jobs, so a job missing from this list — or filed under a
 * tier the scheduler never starts — would leave every test green while the work silently never runs.
 * This is the test that notices.
 */
describe("JOBS", () => {
  it("schedules every job each phase registered, under the tier spec §10.2 gives it", () => {
    expect(JOBS.map((job) => [job.name, job.tier])).toEqual([
      // Every connection by its own schedule (docs/scheduler.md).
      ["integrations-sync", "minute"],
      ["housekeeping", "daily"],
      ["accounts-alerts", "daily"],
      ["accounts-snapshot", "monthly"],
      ["recurrences-refresh", "afterSync"],
      ["subscriptions-check", "daily"],
      ["budgets-alerts", "afterSync"],
      ["interests-accrual", "hourly"],
      ["interests-rematch", "daily"],
      ["funds-deposits", "afterSync"],
      ["pockets-accrual", "daily"],
      ["pockets-planned-cleanup", "daily"],
      ["documents-retention", "daily"],
      ["documents-sweep", "hourly"],
      ["holidays-refresh", "daily"],
      ["fx-rates-refresh", "daily"],
      ["database-backup", "daily"],
      ["monthly-summary", "monthly"],
      // No tick ever asks for `manual`: this one runs only from "Export all data" (spec §10.3).
      ["export-all", "manual"],
    ]);
  });

  it("gives every scheduled job a tier the scheduler actually starts", () => {
    const called = scheduledTiers();
    expect([...called].sort()).toEqual(["daily", "hourly", "minute", "monthly"]);
    for (const job of JOBS) {
      if (job.tier === "manual" || job.tier === "afterSync") continue;
      expect(called.has(job.tier), job.name).toBe(true);
    }
  });

  it("leaves in the hourly tier only what goes by the date or by a stuck document, at :30", () => {
    expect(JOBS.filter((job) => runsIn(job, "hourly")).map((job) => job.name)).toEqual([
      "interests-accrual",
      "documents-sweep",
    ]);
    expect(JOBS.filter((job) => runsIn(job, "minute")).map((job) => job.name)).toEqual(["integrations-sync"]);
    expect(SCHEDULE.hourly).toEqual({ minute: 30 });
  });

  it("registers every job that follows a sync, in the order they read each other", () => {
    expect(AFTER_SYNC_JOBS.map((job) => job.name)).toEqual([
      "recurrences-refresh",
      "subscriptions-check",
      "budgets-alerts",
      "funds-deposits",
    ]);
    for (const job of AFTER_SYNC_JOBS) expect(JOBS).toContain(job);
  });

  it("names each job once: two entries with one name would both answer to it", () => {
    expect(new Set(JOBS.map((job) => job.name)).size).toBe(JOBS.length);
  });
});
