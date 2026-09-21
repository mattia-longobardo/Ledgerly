import "server-only";
import { forEachUser } from "@/modules/users/jobs";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@/platform/jobs/schema";
import { checkSubscriptions } from "./service";

/**
 * Every hour, right after `wallet-sync` in the same tier (spec §10.2: "Wallet transactions, then
 * recurrences and the subscription check"): each user's payment check against the movements the
 * pass just stored. No network: it only reads what is already here.
 */
export const subscriptionsCheckJob: JobDefinition = {
  name: "subscriptions-check",
  tier: "hourly",
  async run(): Promise<JobDetail> {
    let checked = 0;
    let written = 0;
    const counts = await forEachUser("subscriptions-check", async (_person, ctx) => {
      const outcome = await checkSubscriptions(ctx);
      checked += outcome.checked;
      written += outcome.written;
    });
    return { ...counts, subscriptionsChecked: checked, chargesWritten: written };
  },
};
