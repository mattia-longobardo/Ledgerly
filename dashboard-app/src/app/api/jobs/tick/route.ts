import { verifyCronSecret } from "@/lib/auth/machine";
import { ensureJobsRegistered } from "@/platform/jobs/register-all";
import { runTier, type JobTier } from "@/platform/jobs/registry";

export const dynamic = "force-dynamic";

const TIERS: readonly JobTier[] = ["hourly", "daily", "monthly"];

export async function POST(req: Request) {
  const denied = verifyCronSecret(req);
  if (denied) return denied;
  const tier = new URL(req.url).searchParams.get("tier") as JobTier | null;
  if (!tier || !TIERS.includes(tier)) {
    return Response.json({ error: "tier must be hourly, daily or monthly" }, { status: 400 });
  }
  ensureJobsRegistered();
  const results = await runTier(tier, { trigger: "cron", now: new Date() });
  return Response.json({ tier, results }, { status: results.some((r) => r.status === "failed") ? 500 : 200 });
}
