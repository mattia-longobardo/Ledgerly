import "server-only";
import { DOCUMENT_KINDS, isReadKind, type ReadKind, stuckDocuments } from "@ledgerly/domain/imports";
import { processPayslip } from "@ledgerly/domain/payroll";
import type { Ctx } from "@ledgerly/domain/platform/context";
import type { JobDetail } from "@ledgerly/domain/platform/jobs";
import { forEachUser } from "@ledgerly/domain/users";
import type { JobDefinition } from "./registry";

/** A reading that has not moved for this long is taken over by the sweep. */
const STUCK_AFTER_MS = 10 * 60_000;

/** Who reads each kind of document (audit IMP-7): the sweep knows the kinds, never a reader's rules. */
const READERS: Record<
  ReadKind,
  (ctx: Ctx, documentId: string, options: { stuckBefore: Date }) => Promise<unknown>
> = {
  payslip: processPayslip,
};

/**
 * Every hour (spec §10.2 "rete di sicurezza per i documenti in lettura"): a document is read right
 * after its upload; one whose reading never finished — a restart in between — is read here, by the
 * reader of its kind.
 */
export const documentsSweepJob: JobDefinition = {
  name: "documents-sweep",
  tier: "hourly",
  async run(): Promise<JobDetail> {
    let read = 0;
    const now = new Date();
    const kinds = DOCUMENT_KINDS.filter(isReadKind);
    const counts = await forEachUser("documents-sweep", async (_person, ctx) => {
      for (const document of await stuckDocuments(ctx, kinds, now, STUCK_AFTER_MS)) {
        if (!isReadKind(document.kind)) continue;
        const done = await READERS[document.kind](ctx, document.id, {
          stuckBefore: new Date(now.getTime() - STUCK_AFTER_MS),
        });
        if (done) read += 1;
      }
    });
    return { ...counts, documentsRead: read };
  },
};
