// src/app/(app)/investments/api-cases.ts — the queue of the worker that the web process lends
// `/api/v1/investments` (rewrite plan R2) until R4, as the Server Actions of Investments use it:
// «Sync now» and the first flows of a new connection run after the answer.
import "server-only";
import type { InvestmentCases } from "@ledgerly/api";
import { enqueue } from "@ledgerly/domain/platform/jobs";
import { tasks } from "@/platform/jobs/queue";

export const investmentCases: InvestmentCases = {
  async queueSync(ctx, connectionId) {
    await enqueue(tasks.updateConnection(ctx.userId, connectionId, null));
  },
  async queueFirstFlows(ctx, connectionId, accountId) {
    await enqueue(tasks.firstFlows(ctx.userId, connectionId, accountId));
  },
};
