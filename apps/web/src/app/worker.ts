/**
 * What the worker runs (rewrite plan R1): every kind of task of `platform/jobs/queue.ts`, and nothing the web
 * process ever calls. The web package holds the jobs until R4 (`scripts/packages.ts`), so the worker
 * reaches them through this one entry, `@ledgerly/web/jobs`.
 */
import "server-only";
import { z } from "zod";
import { readFirstFlows } from "@ledgerly/domain/investments";
import { readDocument } from "@ledgerly/domain/imports";
import { addonOn, type Ctx } from "@ledgerly/domain/platform/context";
import {
  findConnection,
  isBankPluginProvider,
  PROVIDER_ADDONS,
} from "@ledgerly/domain/platform/integrations";
import type { Task } from "@ledgerly/domain/platform/jobs";
import { categorisableAccountIds, categorise } from "@ledgerly/domain/transactions";
import { contextFor, type Person, personById } from "@ledgerly/domain/users";
import { readBank } from "@ledgerly/plugin-host";
import { passFor } from "@/platform/integrations/registry";
import { runAfterSync } from "@/platform/jobs/after-sync";
import { SCHEDULED_TIERS } from "@/platform/jobs/registry";
import { runJobByHand, runTier } from "@/platform/jobs/tick";
import { bankSink } from "./(app)/banks/sink";
// Registers the passes of the plugins before any task runs (`plugin-wiring.ts` says why here).
import "./plugin-wiring";
// Registers the readers of the documents before a reading or the sweep asks for one.
import "./document-kinds";

export { tasks } from "@/platform/jobs/queue";
export { SCHEDULE, SCHEDULE_TIME_ZONE, SCHEDULED_TIERS } from "@/platform/jobs/registry";

const userId = z.uuid();
const scheduledTier = z.enum(SCHEDULED_TIERS);
const presenceSchema = z.object({ ip: z.string().nullable(), userAgent: z.string().nullable() });

/** A task as the queue holds it: read with zod, as anything that comes back from the database. */
const taskSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tier"), payload: z.object({ tier: scheduledTier }) }),
  z.object({ kind: z.literal("job"), payload: z.object({ name: z.string() }) }),
  z.object({
    kind: z.literal("after-sync"),
    payload: z.object({ tier: z.enum([...SCHEDULED_TIERS, "manual"]) }),
  }),
  z.object({ kind: z.literal("document-read"), payload: z.object({ userId, documentId: z.uuid() }) }),
  z.object({ kind: z.literal("categorise"), payload: z.object({ userId, train: z.boolean() }) }),
  z.object({
    kind: z.literal("first-flows"),
    payload: z.object({ userId, connectionId: z.uuid(), accountId: z.uuid() }),
  }),
  z.object({
    kind: z.literal("connection-update"),
    payload: z.object({ userId, connectionId: z.uuid(), presence: presenceSchema.nullable() }),
  }),
]);

/**
 * "Update now" of one connection (ux/n2-connection-status.md §2.4): the pass of its provider, as
 * the dispatcher makes it, or for a plugin the reading with the person's presence (the `Psu-*`
 * headers, decision C1d). Each reading records its own `sync_runs` row and the connection's state:
 * that is the answer the person sees in the row.
 */
async function updateConnection(
  person: Person,
  ctx: Ctx,
  connectionId: string,
  presence: z.infer<typeof presenceSchema> | null,
): Promise<void> {
  const connection = await findConnection(ctx, connectionId);
  if (!connection) return;
  if (isBankPluginProvider(connection.provider)) {
    const outcome = await readBank(
      ctx,
      {
        pluginId: connection.provider.slice("plugin:".length),
        connectionId,
        presence: presence ?? { ip: null, userAgent: null },
      },
      bankSink,
    );
    if (!outcome.ok || outcome.created + outcome.updated === 0) return;
  } else {
    // Queued before the person turned the provider's addon off (risk R-41): it reads nothing.
    const addon = PROVIDER_ADDONS[connection.provider];
    if (addon && !addonOn(ctx, addon)) return;
    await passFor(connection.provider)?.run(person, ctx, { ...connection, userId: ctx.userId }, new Date());
  }
  // The same checks as after a scheduled pass (docs/scheduler.md), only if the movements changed.
  await runAfterSync("manual");
}

/** Runs one task of the queue. Throws what the task threw: the worker logs it and moves on. */
export async function runTask(raw: Pick<Task, "kind" | "payload">): Promise<void> {
  const task = taskSchema.parse(raw);
  if (task.kind === "tier") {
    await runTier(task.payload.tier);
    return;
  }
  if (task.kind === "job") {
    await runJobByHand(task.payload.name);
    return;
  }
  if (task.kind === "after-sync") {
    await runAfterSync(task.payload.tier);
    return;
  }
  const person = await personById(task.payload.userId);
  if (!person) return;
  const ctx = await contextFor(person);
  switch (task.kind) {
    case "document-read":
      // The only kind of document is the payslip: nothing is read while Payroll is off (H52).
      if (!addonOn(ctx, "payroll")) return;
      // A failure leaves the document `extracting`: `documents-sweep` reads it again (spec §10.2).
      await readDocument(ctx, task.payload.documentId);
      return;
    case "categorise":
      await categorise(ctx, await categorisableAccountIds(ctx), { train: task.payload.train });
      return;
    case "first-flows": {
      if (!addonOn(ctx, "investments")) return;
      const connection = await findConnection(ctx, task.payload.connectionId);
      if (connection) await readFirstFlows(ctx, connection, task.payload.accountId, new Date());
      return;
    }
    case "connection-update":
      await updateConnection(person, ctx, task.payload.connectionId, task.payload.presence);
      return;
  }
}
