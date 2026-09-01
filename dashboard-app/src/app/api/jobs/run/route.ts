import { z } from "zod";
import { isUnauthorizedError, requireUser, unauthorizedResponse } from "@/lib/auth/require-user";
import { runMonthlySnapshot } from "@/lib/jobs/monthly-snapshot";
import { ingestPayslipDocument } from "@/lib/jobs/payslip-ingest";
import { runSweep } from "@/lib/jobs/sweep";
import { runTrekSyncJob } from "@/lib/jobs/trek-sync-job";
import { runWalletRefresh } from "@/lib/jobs/wallet-refresh";

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("job", [
  z.object({
    job: z.literal("monthly_snapshot"),
    monthKey: z
      .string()
      .regex(/^\d{4}-\d{2}-01$/, "monthKey must be a month key pinned to the 1st")
      .optional(),
    /** Clears `poisoned`/`missed` — the manual action PLAN §5 reserves for the owner. */
    force: z.boolean().default(false),
  }),
  z.object({ job: z.literal("sweep") }),
  z.object({ job: z.literal("wallet_refresh") }),
  z.object({ job: z.literal("payslip_ingest"), docId: z.number().int().positive() }),
  z.object({
    job: z.literal("trek_sync"),
    year: z.number().int().min(2000).max(2100).optional(),
  }),
]);

/**
 * The in-app "run now" / clear-poisoned target. Session-authenticated rather
 * than secret-authenticated: this is the only path allowed to revive a month
 * whose automatic retries have stopped, so it must be attributable to the owner.
 */
export async function POST(req: Request) {
  try {
    await requireUser();
  } catch (err) {
    if (isUnauthorizedError(err)) return unauthorizedResponse();
    throw err;
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid request", issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }
  const input = parsed.data;

  if (input.job === "sweep") {
    const result = await runSweep({ trigger: "manual" });
    return Response.json(result, { status: result.status === "failed" ? 500 : 200 });
  }

  if (input.job === "wallet_refresh") {
    const result = await runWalletRefresh({ trigger: "manual" });
    return Response.json(result, { status: result.status === "failed" ? 500 : 200 });
  }

  if (input.job === "payslip_ingest") {
    const result = await ingestPayslipDocument({ docId: input.docId, trigger: "manual" });
    return Response.json(result, { status: result.status === "failed" ? 500 : 200 });
  }

  if (input.job === "trek_sync") {
    const result = await runTrekSyncJob({
      trigger: "manual",
      ...(input.year !== undefined ? { year: input.year } : {}),
    });
    return Response.json(result, { status: result.status === "failed" ? 500 : 200 });
  }

  const result = await runMonthlySnapshot({
    trigger: "manual",
    ...(input.monthKey ? { monthKey: input.monthKey } : {}),
    force: input.force,
  });
  return Response.json(result, { status: result.status === "failed" ? 500 : 200 });
}
