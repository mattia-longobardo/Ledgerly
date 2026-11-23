import "server-only";
import { forEachUser } from "@ledgerly/domain/users";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@ledgerly/domain/platform/jobs";
import { checkSubscriptions } from "@ledgerly/domain/subscriptions";

/**
 * After a sync that changed the movements (`runAfterSync`; spec §10.2: "transactions, then
 * recurrences and the subscription check"): each user's payment check against the movements the
 * pass just stored. Daily too, because the date alone moves a charge: a period that ends unpaid
 * becomes `not_found` and a new period comes into view. No network: it only reads what is here.
 */
export const subscriptionsCheckJob: JobDefinition = {
  name: "subscriptions-check",
  tier: "daily",
  async run(): Promise<JobDetail> {
    let checked = 0;
    let written = 0;
    const counts = await forEachUser(
      "subscriptions-check",
      async (_person, ctx) => {
        const outcome = await checkSubscriptions(ctx);
        checked += outcome.checked;
        written += outcome.written;
      },
      { addon: "subscriptions" },
    );
    return { ...counts, subscriptionsChecked: checked, chargesWritten: written };
  },
};
