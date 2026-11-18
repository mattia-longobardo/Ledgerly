/**
 * The tasks the web asks the worker for (rewrite plan R1): nothing here runs a job, it only describes it,
 * for `enqueue` to put in the queue. The worker runs each kind with `runTask` (`worker.ts`); a task waiting
 * with the same key is the same work, so asking twice runs it once.
 */
import "server-only";
import type { Task } from "@ledgerly/domain/platform/jobs";
import type { RecordedTier, ScheduledTier } from "./registry";

/** Who is present when a person starts a reading: the bank's `Psu-*` headers (04-now.md §4.2). */
interface Presence {
  ip: string | null;
  userAgent: string | null;
}

export const tasks = {
  /** A tier of the scheduler: its jobs one after the other, in the registry's order. */
  tier: (tier: ScheduledTier): Task => ({ kind: "tier", key: `tier:${tier}`, payload: { tier } }),
  /** One job an admin asked for ("Run now"). */
  job: (name: string): Task => ({ kind: "job", key: `job:${name}`, payload: { name } }),
  /** The jobs that read the movements, after a sync that changed them (docs/scheduler.md). */
  afterSync: (tier: RecordedTier): Task => ({ kind: "after-sync", key: "after-sync", payload: { tier } }),
  /** The reading of a document just uploaded (spec §7.8 "subito dopo"). */
  readDocument: (userId: string, documentId: string): Task => ({
    kind: "document-read",
    key: `document-read:${documentId}`,
    payload: { userId, documentId },
  }),
  /** The memory and the cascade of the categories, after a person chose. */
  categorise: (userId: string, train: boolean): Task => ({
    kind: "categorise",
    key: `categorise:${userId}:${train ? "train" : "learn"}`,
    payload: { userId, train },
  }),
  /** The first flows of a service just connected: 24 months of an exchange take minutes. */
  firstFlows: (userId: string, connectionId: string, accountId: string): Task => ({
    kind: "first-flows",
    key: `connection:${connectionId}`,
    payload: { userId, connectionId, accountId },
  }),
  /** "Update now" of a connection: the reading the person asked for, by whoever owns it. */
  updateConnection: (userId: string, connectionId: string, presence: Presence | null): Task => ({
    kind: "connection-update",
    key: `connection:${connectionId}`,
    payload: { userId, connectionId, presence },
  }),
};
