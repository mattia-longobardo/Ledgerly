import { z } from "zod";
import { isUnauthorizedError, requireUser, unauthorizedResponse } from "@/lib/auth/require-user";
import { runSweep } from "@/lib/jobs/sweep";
import { runTrekSyncJob } from "@/lib/jobs/trek-sync-job";

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("job", [
  z.object({ job: z.literal("sweep") }),
  z.object({ job: z.literal("trek_sync") }),
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

  // The manual payslip-ingest retry lever moved to
  // `POST /api/v1/payroll/imports/{id}/retry` (Task 15).

  const result = await runTrekSyncJob({ trigger: "manual" });
  return Response.json(result, { status: result.status === "failed" ? 500 : 200 });
}
