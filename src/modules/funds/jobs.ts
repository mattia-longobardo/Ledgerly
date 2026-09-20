import "server-only";
import { stuckDocuments } from "@/modules/imports/service";
import { forEachUser } from "@/modules/users/jobs";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@/platform/jobs/schema";
import { processCometaDocument } from "./pension/imports";
import { matchDeposits } from "./service";

/**
 * Every hour, after `wallet-sync` (spec §10.2): the movements the pass brought in that a fund's
 * deposit rule recognises become deposits. No network: it reads what is already stored.
 */
export const fundsDepositsJob: JobDefinition = {
  name: "funds-deposits",
  tier: "hourly",
  async run(): Promise<JobDetail> {
    let written = 0;
    const counts = await forEachUser("funds-deposits", async (_person, ctx) => {
      written += (await matchDeposits(ctx)).written;
    });
    return { ...counts, depositsWritten: written };
  },
};

/** A reading that has not moved for this long is taken over by the sweep. */
const STUCK_AFTER_MS = 10 * 60_000;

/**
 * Every hour (spec §10.2 "rete di sicurezza per i documenti in lettura"): a Cometa document is read
 * right after its upload; one whose reading never finished — a restart in between — is read here.
 */
export const cometaSweepJob: JobDefinition = {
  name: "cometa-sweep",
  tier: "hourly",
  async run(): Promise<JobDetail> {
    let read = 0;
    const now = new Date();
    const counts = await forEachUser("cometa-sweep", async (_person, ctx) => {
      const stuck = await stuckDocuments(ctx, ["cometa_operations", "cometa_position"], now, STUCK_AFTER_MS);
      for (const document of stuck) {
        const done = await processCometaDocument(ctx, document.id, {
          stuckBefore: new Date(now.getTime() - STUCK_AFTER_MS),
        });
        if (done) read += 1;
      }
    });
    return { ...counts, documentsRead: read };
  },
};
