import { describe, expect, it } from "vitest";
import { JOBS } from "./registry";

/**
 * The registry is one line per phase and nothing else asserts its contents: `jobs.itest.ts` proves
 * `runTier` works by injecting synthetic jobs, so a job missing from this list — or filed under a
 * tier supercronic never calls — would leave every test green while the work silently never runs.
 * This is the test that notices.
 */
describe("JOBS", () => {
  it("schedules every job each phase registered, under the tier spec §10.2 gives it", () => {
    expect(JOBS.map((job) => [job.name, job.tier])).toEqual([
      ["housekeeping", "daily"],
      ["accounts-alerts", "daily"],
      ["accounts-snapshot", "monthly"],
      ["wallet-sync", "hourly"],
      ["subscriptions-check", "hourly"],
      ["interests-accrual", "hourly"],
      ["funds-deposits", "hourly"],
      ["pockets-accrual", "monthly"],
      ["documents-retention", "daily"],
      ["payslips-sweep", "hourly"],
      ["cometa-sweep", "hourly"],
      ["trek-sync", "hourly"],
      ["holidays-refresh", "daily"],
      ["database-backup", "daily"],
      ["monthly-summary", "monthly"],
      // No tick ever asks for `manual`: this one runs only from "Export all data" (spec §10.3).
      ["export-all", "manual"],
    ]);
  });

  it("gives every scheduled job a tier supercronic actually calls", () => {
    const called = new Set(["hourly", "daily", "monthly"]);
    for (const job of JOBS) {
      if (job.tier === "manual") continue;
      expect(called.has(job.tier), job.name).toBe(true);
    }
  });

  it("names each job once: two entries with one name would both answer to it", () => {
    expect(new Set(JOBS.map((job) => job.name)).size).toBe(JOBS.length);
  });
});
