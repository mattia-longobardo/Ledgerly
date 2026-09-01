import { verifyCronSecret } from "@/lib/auth/machine";
import { runSweep } from "@/lib/jobs/sweep";

export const dynamic = "force-dynamic";

/** Hourly supercronic target: snapshot catch-up, payslip polling, write retries. */
export async function POST(req: Request) {
  const denied = verifyCronSecret(req);
  if (denied) return denied;

  const result = await runSweep({ trigger: "cron" });
  return Response.json(result, { status: result.status === "failed" ? 500 : 200 });
}
