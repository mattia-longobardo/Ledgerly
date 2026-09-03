import { z } from "zod";
import { isUnauthorizedError, requireUser, unauthorizedResponse } from "@/lib/auth/require-user";
import { ingestPayslipDocument } from "@/lib/jobs/payslip-ingest";
import { runSweep } from "@/lib/jobs/sweep";
import { runTrekSyncJob } from "@/lib/jobs/trek-sync-job";
import { runWalletRefresh } from "@/lib/jobs/wallet-refresh";

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("job", [
  z.object({ job: z.literal("sweep") }),
  z.object({ job: z.literal("wallet_refresh") }),
  z.object({ job: z.literal("payslip_ingest"), docId: z.number().int().positive() }),
  z.object({
    job: z.literal("trek_sync"),
    year: z.number().int().min(2000).max(2100).optional(),
  }),
]);

/** The in-app "run now" target. Session-authenticated, so every manual run is attributable to the owner. */
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

  const result = await runTrekSyncJob({
    trigger: "manual",
    ...(input.year !== undefined ? { year: input.year } : {}),
  });
  return Response.json(result, { status: result.status === "failed" ? 500 : 200 });
}
