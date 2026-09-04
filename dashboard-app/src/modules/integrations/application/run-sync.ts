import { assertPermission, type Principal } from "@/platform/auth/principal";
import { redactCredentials } from "@/platform/integrations/redact-credentials";
import type {
  IntegrationConnection,
  ProviderCode,
  SyncHandler,
  SyncKind,
  SyncRun,
  SyncTrigger,
} from "@/platform/integrations/types";
import { isUsable, nextStatusAfterSync } from "../domain/connection";
import type { IntegrationDeps } from "./deps";
import {
  ConnectionNotFoundError,
  ConnectionNotUsableError,
  SyncDisabledError,
  SyncNotSupportedError,
  UnknownProviderError,
} from "./errors";

export interface RunSyncInput {
  provider: ProviderCode;
  /**
   * Optional, and defaulted HERE rather than in each caller: the REST route,
   * the server action and the cron jobs all omit it in the single-sync case,
   * and three separate defaults would eventually disagree.
   */
  kind?: SyncKind;
  trigger: SyncTrigger;
}

interface Resolved {
  handler: SyncHandler;
  kind: SyncKind;
}

function resolve(deps: IntegrationDeps, input: RunSyncInput): Resolved {
  const provider = deps.registry.get(input.provider);
  if (!provider) throw new UnknownProviderError(`No integration named ${input.provider}`);
  const kind = input.kind ?? (Object.keys(provider.syncs)[0] as SyncKind | undefined);
  if (!kind) throw new SyncNotSupportedError(`${input.provider} has no sync to run`);
  const handler = provider.syncs[kind];
  if (!handler) throw new SyncNotSupportedError(`${input.provider} has no ${kind} sync`);
  return { handler, kind };
}

interface Prepared {
  connection: IntegrationConnection;
  credentials: Record<string, string>;
  jobId: string | null;
  cursor: unknown;
  run: SyncRun;
}

/**
 * Everything the provider call needs, gathered in ONE short transaction, plus
 * the `sync_runs` row that says the work has begun.
 *
 * `claimRunId` is set only by `resumeQueuedSync`: instead of inserting a new
 * run it moves an existing `queued` one to `running`, conditionally, so two
 * ticks racing the same queued row execute it once. It returns `null` when it
 * loses that race, and `{ joined }` when a run for this (connection, kind) is
 * already in flight.
 */
async function prepare(
  d: IntegrationDeps,
  userId: string,
  input: RunSyncInput,
  kind: SyncKind,
  handler: SyncHandler,
  claimRunId: string | null,
): Promise<Prepared | { joined: SyncRun } | null> {
  const connection = await d.connections.getByProvider(userId, input.provider);
  if (!connection) throw new ConnectionNotFoundError(`${input.provider} is not connected`);
  if (!isUsable(connection)) {
    throw new ConnectionNotUsableError(`${input.provider} is ${connection.status}; reconnect it first`);
  }

  // Ruling P2-C4: `sync_jobs` is where a kind is switched off without
  // disconnecting the provider, and where its cursor lives. `ensure()`, not
  // `find()`: a trigger can reach a kind before `connectIntegration` ever
  // created its row — a connection that predates the kind (a provider that
  // grew a new `SyncKind` after some connections already existed), or a
  // manual `POST .../sync` naming a kind nothing has synced yet. `ensure()`
  // is the same idempotent insert-then-read `connectIntegration` itself uses,
  // so this never re-enables a kind somebody switched off — it only creates
  // the row when one is genuinely missing. Without this, `job` would be
  // `undefined`, `jobId` below would be `null`, and `execute()`'s cursor
  // write is unconditionally guarded on `prepared.jobId` — so the run would
  // succeed while its cursor silently never persisted.
  const job = await d.jobs.ensure({ connectionId: connection.id, kind, schedule: handler.schedule });
  if (!job.enabled) {
    throw new SyncDisabledError(`${input.provider}'s ${kind} sync is switched off`);
  }

  // Idempotent per running job (spec §6): a second trigger joins the run in
  // flight rather than doubling the work against the provider. A `queued` run
  // is not in flight — nothing has started — so it does not absorb a trigger.
  const inFlight = await d.runs.running(connection.id, kind);
  if (inFlight) return { joined: inFlight };

  const sealed = await d.connections.readCredentials(userId, connection.id);
  if (!sealed) throw new ConnectionNotFoundError(`${input.provider} has no stored credential`);

  const startedAt = d.clock.now();
  const run = claimRunId
    ? await d.runs.claim(claimRunId, startedAt)
    : await d.runs.start({
        connectionId: connection.id,
        jobId: job.id,
        kind,
        trigger: input.trigger,
        startedAt,
      });
  if (!run) return null;

  return {
    connection,
    credentials: d.cipher.open(sealed),
    jobId: job.id,
    cursor: job.cursor,
    run,
  };
}

/**
 * The provider round trip and then the write — in that order, and with nothing
 * open in between.
 *
 * `fetch` runs with no transaction at all, which is the rule Task 2 introduced
 * and the two-phase `SyncHandler` makes structural. `apply` gets one
 * transaction, and it also carries the bookkeeping: the run row, the
 * connection's stamps, the cursor and the audit line all commit or none of them
 * do. A handler that throws still produces a finished `sync_runs` row and a
 * connection in `error` — a run that vanished without a row would be
 * indistinguishable from one that never started.
 */
async function execute(
  deps: IntegrationDeps,
  userId: string,
  input: RunSyncInput,
  kind: SyncKind,
  handler: SyncHandler,
  prepared: Prepared,
): Promise<SyncRun> {
  let payload: unknown;
  try {
    payload = await handler.fetch({
      connection: prepared.connection,
      credentials: prepared.credentials,
      runId: prepared.run.id,
      clock: deps.clock,
      cursor: prepared.cursor,
    });
  } catch (err) {
    return recordFailure(deps, userId, input, kind, prepared, err);
  }

  try {
    return await deps.inUserContext(userId, async (d) => {
      let cursor = prepared.cursor;
      const stats = await handler.apply(
        {
          connection: prepared.connection,
          runId: prepared.run.id,
          db: d.db,
          clock: d.clock,
          cursor,
          setCursor: (next) => {
            cursor = next;
          },
          audit: d.audit,
        },
        payload,
      );
      const finishedAt = d.clock.now();
      await d.runs.finish(prepared.run.id, { status: "success", stats, error: null, finishedAt });
      // Ruling P2-C5: the cursor advances only on success.
      if (prepared.jobId && cursor !== prepared.cursor) await d.jobs.setCursor(prepared.jobId, cursor);
      await d.connections.recordState(prepared.connection.id, {
        status: nextStatusAfterSync(false),
        lastSyncAt: finishedAt,
        lastError: null,
      });
      await d.audit({
        actorUserId: userId,
        action: "integration.sync",
        entityType: "sync_run",
        entityId: prepared.run.id,
        after: { provider: input.provider, kind, trigger: prepared.run.trigger, ...stats },
      });
      return { ...prepared.run, status: "success" as const, stats, finishedAt };
    });
  } catch (err) {
    return recordFailure(deps, userId, input, kind, prepared, err);
  }
}

/** One place decides what a failed run looks like, so the two catch sites cannot drift. */
async function recordFailure(
  deps: IntegrationDeps,
  userId: string,
  input: RunSyncInput,
  kind: SyncKind,
  prepared: Prepared,
  err: unknown,
): Promise<SyncRun> {
  const raw = err instanceof Error ? err.message : String(err);
  const error = redactCredentials(raw, prepared.credentials);
  return deps.inUserContext(userId, async (d) => {
    const finishedAt = d.clock.now();
    await d.runs.finish(prepared.run.id, { status: "failed", stats: {}, error, finishedAt });
    await d.connections.recordState(prepared.connection.id, {
      status: nextStatusAfterSync(true),
      lastError: error,
    });
    await d.audit({
      actorUserId: userId,
      action: "integration.sync_failed",
      entityType: "sync_run",
      entityId: prepared.run.id,
      after: { provider: input.provider, kind, trigger: prepared.run.trigger, error },
    });
    return { ...prepared.run, status: "failed" as const, error, finishedAt };
  });
}

export function runSyncForUser(deps: IntegrationDeps) {
  return async (userId: string, input: RunSyncInput): Promise<SyncRun> => {
    const { handler, kind } = resolve(deps, input);
    const prepared = await deps.inUserContext(userId, (d) => prepare(d, userId, input, kind, handler, null));
    // `prepare` only answers null when it lost a claim, and nothing is claimed
    // on this path — `runs.start` always returns a row.
    if (prepared === null) throw new ConnectionNotFoundError(`${input.provider} sync could not be started`);
    if ("joined" in prepared) return prepared.joined;
    return execute(deps, userId, input, kind, handler, prepared);
  };
}

/**
 * Executes a run that already exists as `queued` (spec §3.4). Null when another
 * tick claimed it first, or when a manual sync for the same kind is already
 * running — both mean "somebody else is doing it", which is not an error.
 */
export function resumeQueuedSync(deps: IntegrationDeps) {
  return async (userId: string, input: RunSyncInput, runId: string): Promise<SyncRun | null> => {
    const { handler, kind } = resolve(deps, input);
    const prepared = await deps.inUserContext(userId, (d) => prepare(d, userId, input, kind, handler, runId));
    if (prepared === null || "joined" in prepared) return null;
    return execute(deps, userId, input, kind, handler, prepared);
  };
}

export function runSync(deps: IntegrationDeps) {
  return async (principal: Principal, input: RunSyncInput): Promise<SyncRun> => {
    assertPermission(principal, "integrations.manage");
    return runSyncForUser(deps)(principal.userId, input);
  };
}
