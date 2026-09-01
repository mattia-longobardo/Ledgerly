import { verifyCronSecret } from "@/lib/auth/machine";
import { runWalletRefresh } from "@/lib/jobs/wallet-refresh";

export const dynamic = "force-dynamic";

/**
 * Daily supercronic target, 12:00 Europe/Rome — Wallet syncs its own upstream
 * banks at noon, so reading it more often learns nothing.
 *
 * 500 only on `failed`: that is the status `curl --retry` should act on. Every
 * other terminal state — `already_done` when a retry lost the race for the job
 * lock — is a correct outcome and answers 200, otherwise the retry would
 * hammer a job that already did its work.
 */
export async function POST(req: Request) {
  const denied = verifyCronSecret(req);
  if (denied) return denied;

  const result = await runWalletRefresh({ trigger: "cron" });
  return Response.json(result, { status: result.status === "failed" ? 500 : 200 });
}
