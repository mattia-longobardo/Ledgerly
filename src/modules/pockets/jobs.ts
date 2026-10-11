import "server-only";
import { forEachUser } from "@/modules/users/jobs";
import { monthKey, today } from "@/platform/dates";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@/platform/jobs/schema";
import { accrueMonth, purgeExpiredPlanned } from "./service";

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

/**
 * Every day (spec §10.2): the planned expenses a week past their day go, in each user's own zone.
 * The pages already stop counting them at that point; this only keeps the table from growing.
 */
export const pocketsPlannedCleanupJob: JobDefinition = {
  name: "pockets-planned-cleanup",
  tier: "daily",
  async run(): Promise<JobDetail> {
    let removed = 0;
    const counts = await forEachUser("pockets-planned-cleanup", async (_person, ctx) => {
      removed += await purgeExpiredPlanned(ctx, today(ctx.timeZone));
    });
    return { ...counts, plannedRemoved: removed };
  },
};
