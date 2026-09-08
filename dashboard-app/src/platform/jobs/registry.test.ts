import { beforeEach, describe, expect, it } from "vitest";
import { listJobs, registerJob, resetRegistry, runTier } from "./registry";

describe("job registry", () => {
  beforeEach(resetRegistry);
  it("runs the jobs of a tier in registration order and never throws", async () => {
    const order: string[] = [];
    registerJob({
      name: "sweep",
      tier: "hourly",
      run: async () => {
        order.push("sweep");
        return { job: "sweep", status: "success" };
      },
    });
    registerJob({
      name: "trek_sync",
      tier: "hourly",
      run: async () => {
        throw new Error("boom");
      },
    });
    registerJob({ name: "wallet_accounts_sync", tier: "daily", run: async () => ({ job: "wallet_accounts_sync", status: "success" }) });
    const results = await runTier("hourly", { trigger: "cron", now: new Date() });
    expect(order).toEqual(["sweep"]);
    expect(results.map((r) => r.status)).toEqual(["success", "failed"]);
    expect(listJobs("daily").map((j) => j.name)).toEqual(["wallet_accounts_sync"]);
  });
  it("rejects a duplicate name", () => {
    registerJob({ name: "sweep", tier: "hourly", run: async () => ({ job: "sweep", status: "success" }) });
    expect(() =>
      registerJob({ name: "sweep", tier: "daily", run: async () => ({ job: "sweep", status: "success" }) }),
    ).toThrow();
  });
});
