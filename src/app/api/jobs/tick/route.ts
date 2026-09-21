import { z } from "zod";
import { readEnv } from "@/platform/env";
import { secretMatches } from "@/platform/jobs/secret";
import { runTier } from "@/platform/jobs/tick";

export const dynamic = "force-dynamic";

const tierSchema = z.enum(["hourly", "daily", "monthly"]);

/** Called by the cron sidecar. Any failed check is a bare 404, so the endpoint reveals nothing. */
export async function POST(request: Request) {
  const tier = tierSchema.safeParse(new URL(request.url).searchParams.get("tier"));
  if (!tier.success || !secretMatches(request.headers.get("x-cron-secret"), readEnv().CRON_SECRET)) {
    return new Response(null, { status: 404 });
  }
  return Response.json({ tier: tier.data, outcomes: await runTier(tier.data) });
}
