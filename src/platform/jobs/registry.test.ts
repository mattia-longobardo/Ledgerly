import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JOBS, runsIn } from "./registry";

/** The tiers `cron/crontab` really asks for: the file supercronic runs, not a copy of it. */
function crontabTiers(): Set<string> {
  const crontab = readFileSync(new URL("../../../cron/crontab", import.meta.url), "utf8");
  return new Set([...crontab.matchAll(/^[^#].*tier=([a-z]+)/gm)].map((match) => match[1]));
}

/**
 * The registry is one line per phase and nothing else asserts its contents: `jobs.itest.ts` proves
 * `runTier` works by injecting synthetic jobs, so a job missing from this list — or filed under a
 * tier supercronic never calls — would leave every test green while the work silently never runs.
 * This is the test that notices.
 */
describe("JOBS", () => {
  it("schedules every job each phase registered, under the tier spec §10.2 gives it", () => {
    expect(JOBS.map((job) => [job.name, job.tier])).toEqual([
      // Every connection by its own schedule (docs/scheduler.md); in `hourly` too, first.
      ["integrations-sync", "minute"],
      ["housekeeping", "daily"],
      ["accounts-alerts", "daily"],
      ["accounts-snapshot", "monthly"],
      ["recurrences-refresh", "hourly"],
      ["subscriptions-check", "hourly"],
      ["budgets-alerts", "hourly"],
      ["interests-accrual", "hourly"],
      ["interests-rematch", "daily"],
      ["funds-deposits", "hourly"],
      ["pockets-accrual", "monthly"],
      ["pockets-planned-cleanup", "daily"],
      ["documents-retention", "daily"],
      ["payslips-sweep", "hourly"],
      ["cometa-sweep", "hourly"],
      ["holidays-refresh", "daily"],
      ["fx-rates-refresh", "daily"],
      ["database-backup", "daily"],
      ["monthly-summary", "monthly"],
      // No tick ever asks for `manual`: this one runs only from "Export all data" (spec §10.3).
      ["export-all", "manual"],
    ]);
  });

  it("gives every scheduled job a tier supercronic actually calls", () => {
    const called = crontabTiers();
    expect([...called].sort()).toEqual(["daily", "hourly", "minute", "monthly"]);
    for (const job of JOBS) {
      if (job.tier === "manual") continue;
      expect(called.has(job.tier), job.name).toBe(true);
      for (const tier of job.alsoIn ?? []) expect(called.has(tier), job.name).toBe(true);
    }
  });

  it("runs the integrations dispatcher first in the hourly tier, before what reads its result", () => {
    const hourly = JOBS.filter((job) => runsIn(job, "hourly")).map((job) => job.name);
    expect(hourly[0]).toBe("integrations-sync");
    expect(hourly.indexOf("recurrences-refresh")).toBeLessThan(hourly.indexOf("subscriptions-check"));
    expect(JOBS.filter((job) => runsIn(job, "minute")).map((job) => job.name)).toEqual(["integrations-sync"]);
  });

  it("names each job once: two entries with one name would both answer to it", () => {
    expect(new Set(JOBS.map((job) => job.name)).size).toBe(JOBS.length);
  });
});
