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
      ["interests-accrual", "daily"],
      ["accounts-snapshot", "monthly"],
      ["wallet-sync", "hourly"],
      ["subscriptions-check", "hourly"],
      ["funds-deposits", "hourly"],
      ["pockets-accrual", "monthly"],
    ]);
  });

  it("names each job once: two entries with one name would both answer to it", () => {
    expect(new Set(JOBS.map((job) => job.name)).size).toBe(JOBS.length);
  });
});
