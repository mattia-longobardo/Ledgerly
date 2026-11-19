// src/app/(app)/expenses/api-cases.ts — the use cases of transactions that the web process lends
// `/api/v1` (rewrite plan R2), as it lends its guard: the manual movement joins accounts for its
// balance (`manual.ts`), the source of a movement is a provider of the core until R5c (its port is
// in `platform/integrations`), and the queue of the categorisation is the web's. The Server Actions call the same functions.
import "server-only";
import type { TransactionCases } from "@ledgerly/api";
import { editableAtSource, editAtSource, syncSourceNow } from "@ledgerly/domain/platform/integrations/source";
import { redactForLog } from "@ledgerly/domain/platform/auth";
import { enqueue } from "@ledgerly/domain/platform/jobs";
import { tasks } from "@/platform/jobs/queue";
import {
  changeVisibility,
  createManual,
  deleteManual,
  manualAccounts,
  previewManual,
  retrySend,
  sendSourceNames,
  updateManual,
} from "./manual";

export const transactionCases: TransactionCases = {
  editableAtSource: (ctx, ids) => editableAtSource(ctx, ids),
  sendSources: (ctx, accountIds) => sendSourceNames(ctx, accountIds),
  async editAtSource(ctx, id, edit) {
    const outcome = await editAtSource(ctx, id, edit);
    if (outcome.state === "refused" || outcome.state === "failed") {
      return { state: outcome.state, reason: outcome.reason };
    }
    return { state: outcome.state };
  },
  manualAccounts: (ctx) => manualAccounts(ctx),
  previewManual: (ctx, input) => previewManual(ctx, input),
  async createManual(ctx, movement, key) {
    const { transaction, created } = await createManual(ctx, movement, key);
    return { id: transaction.id, created };
  },
  async updateManual(ctx, id, movement) {
    return { id: (await updateManual(ctx, id, movement)).id };
  },
  deleteManual: (ctx, id) => deleteManual(ctx, id),
  // The pass a «Sync now» makes, without the session the card's action reads; `retrySend` looks at
  // the movement after it, so a pass that fails only leaves the movement waiting.
  retrySend: (ctx, id) =>
    retrySend(ctx, id, async (provider) => {
      try {
        if (await syncSourceNow(ctx, provider)) await enqueue(tasks.afterSync("manual"));
      } catch (error) {
        console.error("[transactions] a source's pass failed", redactForLog(error));
      }
    }),
  changeVisibility: (ctx, ids, change) => changeVisibility(ctx, ids, change),
  async learn(ctx, train) {
    await enqueue(tasks.categorise(ctx.userId, train));
  },
};
