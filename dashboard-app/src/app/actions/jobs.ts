"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import type { JobResult } from "@/lib/contracts";
import { runMonthlySnapshot } from "@/lib/jobs/monthly-snapshot";
import { getMonthlySnapshot } from "@/lib/repo/jobs";
import { monthKeyOf } from "@/lib/time";
import { errorMessage, fail, succeed, type ActionResult } from "./types";

const monthSchema = z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/);

function revalidateJobs(): void {
  revalidatePath("/settings");
  revalidatePath("/");
}

/**
 * The in-app "run now". `/api/jobs/run` is the session-authenticated twin of
 * this action — the cron sidecar uses the secret-authenticated routes instead.
 * Calling the job function directly keeps the owner's identity on the call
 * without a loopback request that would carry no session cookie.
 */
export async function runSnapshotNow(): Promise<ActionResult<JobResult>> {
  await requireUser();

  try {
    const result = await runMonthlySnapshot({ trigger: "manual" });
    revalidateJobs();
    if (result.status === "failed" || result.status === "poisoned") {
      return fail(result.error ?? "The snapshot job failed. See the runs below.");
    }
    return succeed(result);
  } catch (err) {
    revalidateJobs();
    return fail(errorMessage(err));
  }
}

/**
 * A poisoned month has exhausted its 8 attempts and stopped retrying by design.
 * `force` is the only thing that revives it, and it is deliberately reachable
 * from nowhere but here — cron and the sweep never set it.
 */
export async function clearPoisonedSnapshot(month: string): Promise<ActionResult<JobResult>> {
  await requireUser();

  const parsed = monthSchema.safeParse(month);
  if (!parsed.success) return fail("That is not a month key.");
  const key = monthKeyOf(parsed.data);

  const existing = await getMonthlySnapshot(key);
  if (existing !== null && existing.status !== "poisoned" && existing.status !== "missed") {
    return fail("That month is not poisoned.");
  }

  try {
    const result = await runMonthlySnapshot({ trigger: "manual", monthKey: key, force: true });
    revalidateJobs();
    if (result.status === "failed" || result.status === "poisoned") {
      return fail(result.error ?? "The retry failed again.");
    }
    return succeed(result);
  } catch (err) {
    revalidateJobs();
    return fail(errorMessage(err));
  }
}
