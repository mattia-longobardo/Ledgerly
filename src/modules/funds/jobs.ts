import "server-only";
import { forEachUser } from "@/modules/users/jobs";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@/platform/jobs/schema";
import { matchDeposits } from "./service";

/**
 * Every hour, after `wallet-sync` (spec §10.2): the movements the pass brought in that a fund's
 * deposit rule recognises become deposits. No network: it reads what is already stored.
 */
export const fundsDepositsJob: JobDefinition = {
  name: "funds-deposits",
  tier: "hourly",
  async run(): Promise<JobDetail> {
    let written = 0;
    const counts = await forEachUser("funds-deposits", async (_person, ctx) => {
      written += (await matchDeposits(ctx)).written;
    });
    return { ...counts, depositsWritten: written };
  },
};
