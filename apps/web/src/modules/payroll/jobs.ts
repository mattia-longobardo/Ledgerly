import "server-only";
import { stuckDocuments } from "@ledgerly/domain/imports";
import { forEachUser } from "@ledgerly/domain/users";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@ledgerly/domain/platform/jobs";
import { processPayslip } from "@ledgerly/domain/payroll";

/** A reading that has not moved for this long is taken over by the sweep. */
const STUCK_AFTER_MS = 10 * 60_000;

/**
 * Every hour (spec §10.2 "rete di sicurezza per i documenti in lettura"): a payslip is read right
 * after its upload; one whose reading never finished — a restart in between — is read here.
 */
export const payslipsSweepJob: JobDefinition = {
  name: "payslips-sweep",
  tier: "hourly",
  async run(): Promise<JobDetail> {
    let read = 0;
    const now = new Date();
    const counts = await forEachUser("payslips-sweep", async (_person, ctx) => {
      for (const document of await stuckDocuments(ctx, ["payslip"], now, STUCK_AFTER_MS)) {
        const done = await processPayslip(ctx, document.id, {
          stuckBefore: new Date(now.getTime() - STUCK_AFTER_MS),
        });
        if (done) read += 1;
      }
    });
    return { ...counts, documentsRead: read };
  },
};
