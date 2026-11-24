// `investment-plans` (rewrite plan R5d, step 2; §11.3.2): each day after the closes, the instalments of
// every active purchase plan come due, are priced, and are proposed or written (`runDuePlans`).
// Idempotent: one instalment a due date, however often it runs.
import { runDuePlans } from "@ledgerly/domain/investments";
import { forEachUser } from "@ledgerly/domain/users";

/** What the run says in `job_runs.detail` (no import of the jobs). */
type RunDetail = Record<string, string | number | boolean | null>;

export async function runInvestmentPlans(now: Date = new Date()): Promise<RunDetail> {
  let advanced = 0;
  const { users, failed } = await forEachUser(
    "investment-plans",
    async (_person, ctx) => {
      advanced += (await runDuePlans(ctx, now)).advanced;
    },
    { addon: "investments" },
  );
  return { users, failed, advanced };
}
