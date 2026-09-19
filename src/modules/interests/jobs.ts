import "server-only";
import { and, eq } from "drizzle-orm";
import { forEachUser } from "@/modules/users/jobs";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@/platform/jobs/schema";
import { interestRules } from "./schema";
import { postPending } from "./posting";
import { bringUpToDate } from "./service";

/**
 * Every day at 12:00 (spec §10.2): each user's active rules accrued up to yesterday — the day whose
 * balance is closed — and the periods that have ended settled. A day the job missed is caught up
 * on the next run, in order. Then the settlements of the rules that publish are posted to Wallet
 * (spec §7.6), with no transaction open while Wallet is called.
 */
export const interestsAccrualJob: JobDefinition = {
  name: "interests-accrual",
  tier: "daily",
  async run(): Promise<JobDetail> {
    let rules = 0;
    let posted = 0;
    const counts = await forEachUser("interests-accrual", async (_person, ctx) => {
      const active = await getDb()
        .select({ id: interestRules.id })
        .from(interestRules)
        .where(and(userScoped(ctx).owns(interestRules), eq(interestRules.state, "active")));
      for (const rule of active) {
        await bringUpToDate(ctx, rule.id);
        rules += 1;
      }
      // Publishing comes after, outside every transaction; an unsure posting is left as it is.
      posted += await postPending(ctx);
    });
    return { ...counts, rules, posted };
  },
};
