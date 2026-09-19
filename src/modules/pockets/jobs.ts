import "server-only";
import { forEachUser } from "@/modules/users/jobs";
import { monthKey, today } from "@/platform/dates";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@/platform/jobs/schema";
import { accrueMonth } from "./service";

/**
 * The 1st of the month at 00:05 (spec §10.2, §7.4): each user's current month accrued on every
 * active pocket, in their own zone. Idempotent — the database keeps one accrual per pocket and
 * month — so a second run, or one after a pocket was created on the 1st, writes nothing twice.
 */
export const pocketsAccrualJob: JobDefinition = {
  name: "pockets-accrual",
  tier: "monthly",
  async run(): Promise<JobDetail> {
    let written = 0;
    const counts = await forEachUser("pockets-accrual", async (_person, ctx) => {
      written += (await accrueMonth(ctx, monthKey(today(ctx.timeZone)))).written;
    });
    return { ...counts, accrualsWritten: written };
  },
};
