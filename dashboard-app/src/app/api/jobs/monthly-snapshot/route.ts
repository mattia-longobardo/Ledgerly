import { verifyCronSecret } from "@/lib/auth/machine";
import { runMonthlySnapshot } from "@/lib/jobs/monthly-snapshot";

export const dynamic = "force-dynamic";

/**
 * supercronic target, 23:59 on the 1st (PLAN §5). Reached only over the
 * internal Docker network; Traefik has no route for `/api/jobs/*`.
 *
 * Only `failed` answers 5xx: that is the status curl's `--retry` should act on.
 * `poisoned` and `missed` are terminal decisions, and answering 5xx there would
 * make the sidecar hammer a month that is deliberately waiting for a human.
 */
export async function POST(req: Request) {
  const denied = verifyCronSecret(req);
  if (denied) return denied;

  const result = await runMonthlySnapshot({ trigger: "cron" });
  return Response.json(result, { status: result.status === "failed" ? 500 : 200 });
}
