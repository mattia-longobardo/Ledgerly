import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Person } from "../../users/jobs";
import type { Ctx } from "../../../platform/context";
import { today } from "../../../platform/dates";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import {
  type HoldingsSnapshot,
  type KeyCheck,
  sourceErrorLog,
} from "../../../platform/integrations/investments/source";
import type { DueConnection } from "../../../platform/integrations/service";
import {
  deleteConnection,
  listConnections,
  listRuns,
  markConnection,
  readCredentials,
  readSyncJob,
  recordRun,
  saveConnection,
  saveSyncJob,
  skipRun,
} from "../../../platform/integrations/service";
import { withJobLock } from "../../../platform/jobs/lock";
import { connectableProvider, credentialSchemaOf } from "../catalog";
import { MANUAL_MODE, valueOn } from "../rules";
import {
  investmentAccountPeriods,
  investmentAccounts,
  investmentKeyChecks,
  investmentReadings,
  investmentReadingScopes,
} from "../schema";
import {
  insertEvent,
  loadBook,
  lockInvestmentAccount,
  periodOn,
  ratesFor,
  rebuild,
  requireInvestmentAccount,
  type WriteCtx,
} from "../service";
import { connectionOf } from "./connect";
import { linkedOf, noteFailure, todayLookup, type Linked } from "./quantities";
import { insertKeyCheck, retireKeys } from "./readings";
import { runFlows, runHoldings } from "./settle";
import { BACKOFF_KEY, COOLDOWN_MS, SyncError, codeOf, sourceOf, takeKeyAttempt, type Defer } from "./sources";

async function backoffUntil(ctx: Pick<Ctx, "userId">, connectionId: string): Promise<Date | null> {
  const job = await readSyncJob(ctx, connectionId, "holdings");
  const value = job?.cursor?.[BACKOFF_KEY];
  if (!value) return null;
  const until = new Date(value);
  return Number.isNaN(until.getTime()) ? null : until;
}

/** One pass of a connection, with its lock (V9) and separate outcomes for holdings and flows (A8). */
async function passOf(
  ctx: WriteCtx,
  linked: Linked,
  now: Date,
  defer?: Defer,
): Promise<"answered" | "failed" | "refused"> {
  const { connection } = linked;
  const until = await backoffUntil(ctx, connection.id);
  if (connection.state === "revoked" || (until !== null && until > now)) {
    const reason =
      connection.state === "revoked"
        ? `${connection.provider} · revoked`
        : `${connection.provider} · rate_limited`;
    for (const kind of ["holdings", "flows"] as const) {
      const run = await recordRun(ctx, { connectionId: connection.id, kind });
      await skipRun(ctx, run.id, reason, now);
    }
    return "refused";
  }
  const holdings = await runHoldings(ctx, linked, now);
  if (holdings === "refused") return "refused";
  if (defer) {
    // "Sync now" answers with the value; the flows follow under the same lock (A8: apart anyway).
    defer(() => withJobLock(`investments-sync:${linked.connection.id}`, () => runFlows(ctx, linked, now)));
    return holdings;
  }
  const flows = await runFlows(ctx, linked, now);
  return holdings === "answered" && flows ? "answered" : "failed";
}

async function lockedPass(ctx: WriteCtx, linked: Linked, now: Date, defer?: Defer) {
  const result = await withJobLock(`investments-sync:${linked.connection.id}`, () =>
    passOf(ctx, linked, now, defer),
  );
  return result.ran ? result.value : ("busy" as const);
}

/** The dispatcher's pass of an investment connection (`platform/integrations/registry.ts`). */
export async function runInvestmentPass(
  _person: Person,
  ctx: Ctx,
  due: DueConnection,
  now: Date = new Date(),
): Promise<"answered" | "failed" | "refused" | "busy" | "absent"> {
  const connection = (await listConnections(ctx)).find((one) => one.id === due.id);
  if (!connection) return "absent";
  const linked = await linkedOf(ctx, connection);
  if (!linked) return "absent";
  return lockedPass(ctx, linked, now);
}

async function linkedAccount(ctx: Pick<Ctx, "userId">, accountId: string): Promise<Linked> {
  const investment = await requireInvestmentAccount(ctx, accountId);
  const connection = await connectionOf(ctx, investment.provider);
  if (!connection) throw new SyncError("not_connected");
  const linked = await linkedOf(ctx, connection);
  if (!linked || linked.investment.id !== investment.id) throw new SyncError("not_connected");
  return linked;
}

/** "Sync now" (§4.3): the same pass, at most once a minute per connection (SEC-09). */
export async function syncNow(
  ctx: WriteCtx,
  accountId: string,
  now: Date = new Date(),
  /** The flows after the answer (the action passes Next's `after`); inline by default. */
  defer?: Defer,
) {
  const linked = await linkedAccount(ctx, accountId);
  const [last] = await listRuns(ctx, { connectionId: linked.connection.id, limit: 1 });
  if (last && now.getTime() - last.startedAt.getTime() < COOLDOWN_MS) throw new SyncError("cooldown");
  const outcome = await lockedPass(ctx, linked, now, defer);
  if (outcome === "busy") throw new SyncError("cooldown");
  return outcome;
}

/** "Verify" (§4.3): the key's permissions again, with the same cooldown; nothing else is read. */
export async function verifyKey(
  ctx: WriteCtx,
  accountId: string,
  now: Date = new Date(),
): Promise<KeyCheck["result"]> {
  const linked = await linkedAccount(ctx, accountId);
  const [last] = await getDb()
    .select({ checkedAt: investmentKeyChecks.checkedAt })
    .from(investmentKeyChecks)
    .where(
      and(
        userScoped(ctx).owns(investmentKeyChecks),
        eq(investmentKeyChecks.investmentAccountId, linked.investment.id),
      ),
    )
    .orderBy(desc(investmentKeyChecks.checkedAt))
    .limit(1);
  if (last && now.getTime() - last.checkedAt.getTime() < COOLDOWN_MS) throw new SyncError("cooldown");
  let check: KeyCheck | null = null;
  try {
    check = await sourceOf(linked.connection.provider).verifyReadOnly(
      await readCredentials(ctx, linked.connection.id),
    );
  } catch (error) {
    await insertKeyCheck(ctx, getDb(), {
      investmentAccountId: linked.investment.id,
      connectionId: linked.connection.id,
      provider: linked.connection.provider,
      origin: "verify",
      check: null,
      now,
    });
    await noteFailure(ctx, linked, error, now, "check");
    throw new SyncError(codeOf(error));
  }
  await insertKeyCheck(ctx, getDb(), {
    investmentAccountId: linked.investment.id,
    connectionId: linked.connection.id,
    provider: linked.connection.provider,
    origin: "verify",
    check,
    now,
  });
  if (check.result === "read-only" && linked.connection.state !== "active") {
    await markConnection(ctx, linked.connection.id, "active", undefined, now);
  } else if (check.result !== "read-only") {
    await markConnection(
      ctx,
      linked.connection.id,
      "error",
      `${linked.connection.provider} · key_${check.result.replace("-", "_")}`,
      now,
    );
  }
  return check.result;
}

/** The provider's id of the account (eToro `gcid`, Binance `uid`) the latest reading came from. */
async function lastExternalAccountOf(ctx: Pick<Ctx, "userId">, investmentAccountId: string) {
  const [row] = await getDb()
    .select({ externalAccountId: investmentReadingScopes.externalAccountId })
    .from(investmentReadingScopes)
    .innerJoin(investmentReadings, eq(investmentReadings.id, investmentReadingScopes.readingId))
    .where(
      and(
        userScoped(ctx).owns(investmentReadings),
        userScoped(ctx).owns(investmentReadingScopes),
        eq(investmentReadings.investmentAccountId, investmentAccountId),
      ),
    )
    .orderBy(
      desc(investmentReadings.on),
      desc(investmentReadings.observedAt),
      asc(investmentReadingScopes.externalAccountId),
    )
    .limit(1);
  return row?.externalAccountId ?? null;
}

/**
 * "Replace key" (§5.3): through the same checks as a connection; on any failure the old key stays.
 * The new key must read the same external account as the latest reading (PERS-87 SEC-03). The old
 * key is retired, and the page asks for it to be revoked at the provider (SEC-07).
 */
export async function replaceKey(
  ctx: WriteCtx,
  accountId: string,
  credentials: Readonly<Record<string, string>>,
  now: Date = new Date(),
): Promise<void> {
  const linked = await linkedAccount(ctx, accountId);
  const provider = connectableProvider(linked.connection.provider);
  if (!provider) throw new SyncError("unknown_provider");
  const parsed = credentialSchemaOf(provider).safeParse(credentials);
  if (!parsed.success) throw new SyncError("invalid_credentials");
  const keys = parsed.data as Record<string, string>;
  takeKeyAttempt(ctx, provider.id, now);
  const source = sourceOf(provider.id);
  let check: KeyCheck;
  let snapshot: HoldingsSnapshot;
  try {
    check = await source.verifyReadOnly(keys);
    if (check.result !== "read-only") throw new SyncError("not_read_only");
    snapshot = await source.fetchHoldings(
      keys,
      linked.currency,
      now,
      await todayLookup(ctx, linked.currency, now),
    );
  } catch (error) {
    if (!(error instanceof SyncError))
      console.error("[investments] key not replaced", sourceErrorLog(provider.id, error));
    throw new SyncError(codeOf(error));
  }
  const previous = await lastExternalAccountOf(ctx, linked.investment.id);
  if (previous !== null && previous !== snapshot.externalAccountId) throw new SyncError("different_account");
  await saveConnection(ctx, { provider: provider.id, credentials: keys });
  await getDb().transaction(async (tx) => {
    await retireKeys(ctx, tx, linked.investment.id, now);
    await insertKeyCheck(ctx, tx, {
      investmentAccountId: linked.investment.id,
      connectionId: linked.connection.id,
      provider: provider.id,
      origin: "replace",
      check,
      now,
    });
  });
  await saveSyncJob(ctx, linked.connection.id, "holdings", { cursor: null }, now);
}

/**
 * "Disconnect" (§2.5, §5.3): synced → manual at today, V before = V after — a manual service keeps
 * only its value (PERS-335), so V(T) becomes its first account valuation and the positions stay in
 * the history — then the key goes. The page then shows the steps to revoke it at the provider.
 */
export async function disconnectProvider(
  ctx: WriteCtx,
  accountId: string,
  now: Date = new Date(),
): Promise<void> {
  const linked = await linkedAccount(ctx, accountId);
  const todayOn = today(ctx.timeZone, now);
  await getDb().transaction(async (tx) => {
    const investment = await lockInvestmentAccount(ctx, accountId, tx);
    const book = await loadBook(ctx, investment, linked.currency, tx);
    const current = periodOn(book, todayOn);
    if (current === null || current.origin !== "synced") throw new SyncError("not_connected");
    const rates = await ratesFor(book, todayOn);
    const value = valueOn(book, todayOn, rates).valueCents;
    const startsAt =
      current.startsAt.getTime() >= now.getTime() ? new Date(current.startsAt.getTime() + 1) : now;
    await tx.insert(investmentAccountPeriods).values(
      userScoped(ctx).stamp({
        investmentAccountId: investment.id,
        fromOn: todayOn,
        startsAt,
        // A manual service keeps only its value (PERS-335): the positions stay in the history.
        mode: MANUAL_MODE,
        origin: "manual" as const,
        reason: "conversion" as const,
      }),
    );
    if (value !== null) {
      await insertEvent(ctx, tx, investment.id, {
        on: todayOn,
        occurredAt: startsAt,
        origin: "conversion",
        legs: [{ leg: "main", kind: "account_valuation", amountCents: value }],
      });
    }
    await retireKeys(ctx, tx, investment.id, now);
    await tx
      .update(investmentAccounts)
      .set({ provider: "manual", updatedAt: now })
      .where(and(eq(investmentAccounts.id, investment.id), userScoped(ctx).owns(investmentAccounts)));
    await rebuild(ctx, investment, linked.currency, todayOn, tx);
  });
  await deleteConnection(ctx, linked.connection.id);
}

/** "I revoked it" (SEC-07): the retired keys of a service are confirmed revoked at the provider. */
export async function confirmKeyRevoked(ctx: Pick<Ctx, "userId">, accountId: string, now: Date = new Date()) {
  const investment = await requireInvestmentAccount(ctx, accountId);
  await getDb()
    .update(investmentKeyChecks)
    .set({ revokedAtProviderAt: now })
    .where(
      and(
        userScoped(ctx).owns(investmentKeyChecks),
        eq(investmentKeyChecks.investmentAccountId, investment.id),
        isNull(investmentKeyChecks.revokedAtProviderAt),
        // Only keys that stopped being used: the current one is not revoked.
        isNotNull(investmentKeyChecks.retiredAt),
      ),
    );
}
