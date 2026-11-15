import "server-only";
import { forEachUser } from "@/modules/users/jobs";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@/platform/jobs/schema";
import { matchDebits } from "./service";

/**
 * After a sync that changed the movements (`runAfterSync`): the movements the pass brought in that
 * a fund's recurring debit recognises become voluntary contributions of that fund. No network: it
 * reads what is already stored.
 */
export const fundsDepositsJob: JobDefinition = {
  name: "funds-deposits",
  tier: "afterSync",
  async run(): Promise<JobDetail> {
    let written = 0;
    const counts = await forEachUser("funds-deposits", async (_person, ctx) => {
      written += (await matchDebits(ctx)).written;
    });
    return { ...counts, depositsWritten: written };
  },
};
