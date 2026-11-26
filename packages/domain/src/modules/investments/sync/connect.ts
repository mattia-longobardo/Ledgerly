import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { balanceDays, getAccount, openedNoLaterThan, takeOverEntries } from "../../accounts";
import type { Ctx } from "../../../platform/context";
import { type CivilDate, today } from "../../../shared/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import {
  type HoldingsSnapshot,
  type KeyCheck,
  sourceErrorLog,
} from "../../../platform/integrations/investments/source";
import {
  type Connection,
  deleteConnection,
  listConnections,
  saveConnection,
  saveSchedule,
} from "../../../platform/integrations/service";
import { withJobLock } from "../../../platform/jobs/lock";
import {
  accountTypeOf,
  connectableProvider,
  credentialSchemaOf,
  type InvestmentProvider,
  PROVIDER_SCHEDULE,
} from "../catalog";
import { investmentAccountPeriods, investmentAccounts, investmentSupersededEntries } from "../schema";
import {
  eligibleAccounts,
  linkCashLegs,
  type InvestmentAccount,
  loadBook,
  lockInvestmentAccount,
  rebuild,
  requireInvestmentAccount,
} from "../service";
import { estimateHistoryOf, syncFlows } from "./history";
import { linkedOf, todayLookup } from "./quantities";
import { insertKeyCheck, statusOf, writeCoverage, writeReading } from "./readings";
import { settleCutoff } from "./settle";
import { SyncError, codeOf, sourceOf, takeKeyAttempt } from "./sources";

// ——— Connecting (§4.2, §5.1) ————————————————————————————————————————————————————————————————

/** The account of Accounts a key is connected to (PERS-342): Investments creates none. */
export const connectTargetSchema = z.object({ kind: z.literal("existing"), accountId: z.uuid() });
export type ConnectTarget = z.input<typeof connectTargetSchema>;

export async function connectionOf(ctx: Pick<Ctx, "userId">, provider: string): Promise<Connection | null> {
  return (await listConnections(ctx)).find((one) => one.provider === provider) ?? null;
}

/**
 * The account a key may be connected to (§1.3): a manual account of Accounts no one else writes, or
 * a manual service on one. An account a source reads is never one: it would have two writers. An
 * account with no balance yet — made in Accounts for this service — takes the provider's history
 * from its first day, as a new one did (`adopt`); one with balances is handed over from today.
 */
async function targetOf(
  ctx: Ctx,
  provider: InvestmentProvider,
  target: z.output<typeof connectTargetSchema>,
) {
  const allowed = (currency: string) =>
    provider.currencies === null || provider.currencies.includes(currency);
  const account = await getAccount(ctx, target.accountId);
  if (!account || account.state === "archived") throw new SyncError("not_eligible");
  if (!allowed(account.currency)) throw new SyncError("unsupported_currency");
  if (account.type !== accountTypeOf(provider.category)) throw new SyncError("not_eligible");
  if (account.origin !== "manual") throw new SyncError("not_eligible");
  const investment = await requireInvestmentAccount(ctx, account.id).catch(() => null);
  if (investment) {
    if (investment.provider !== "manual") throw new SyncError("not_eligible");
    return { kind: "service" as const, currency: account.currency, investment, accountId: account.id };
  }
  const eligible = (await eligibleAccounts(ctx)).find((one) => one.account.id === account.id);
  if (!eligible || eligible.reason !== null) throw new SyncError("not_eligible");
  const empty = ((await balanceDays(ctx, [account.id])).get(account.id) ?? []).length === 0;
  return {
    kind: empty ? ("adopt" as const) : ("handover" as const),
    currency: account.currency,
    accountId: account.id,
  };
}

/**
 * The handover of an account (§1.3, A4): its balances from `from` go to the archive with their
 * reason, so the provider is its one writer from that day.
 */
async function takeOver(ctx: Pick<Ctx, "userId">, accountId: string, from: CivilDate, tx: Tx): Promise<void> {
  const removed = await takeOverEntries(ctx, accountId, from, tx);
  if (removed.length === 0) return;
  await tx.insert(investmentSupersededEntries).values(
    removed.map((entry) =>
      userScoped(ctx).stamp({
        accountId: entry.accountId,
        balanceEntryId: entry.id,
        on: entry.on,
        balanceCents: entry.balanceCents,
        availableCents: entry.availableCents,
        source: entry.source,
        note: entry.note,
        capturedAt: entry.capturedAt,
        reason: "handover",
      }),
    ),
  );
}

/**
 * The only way a key of an investment provider is saved (SEC-05, §5.1): the strict schema of the
 * provider (SEC-03), the read-only check (§5.2) and a test reading, then `saveConnection`, the key
 * check, the account (new, handed over, or a manual service converted, §2.5) with its first
 * reading and the 12 months of history (D11). If the provider does not answer, nothing is saved.
 */
export async function connectInvestmentProvider(
  ctx: Ctx,
  providerId: string,
  credentials: Readonly<Record<string, string>>,
  input: ConnectTarget,
  now: Date = new Date(),
  /**
   * Puts the first flows in the worker's queue instead of reading them here (Binance reads 24
   * months: minutes, §3.2); inline by default. The worker reads them with {@link readFirstFlows}.
   */
  queueFlows?: (connectionId: string, accountId: string) => Promise<unknown>,
): Promise<{ accountId: string; ipRestricted: boolean | null }> {
  const provider = connectableProvider(providerId);
  if (!provider) throw new SyncError("unknown_provider");
  const parsedCredentials = credentialSchemaOf(provider).safeParse(credentials);
  if (!parsedCredentials.success) throw new SyncError("invalid_credentials");
  const keys = parsedCredentials.data as Record<string, string>;
  const parsedTarget = connectTargetSchema.safeParse(input);
  if (!parsedTarget.success) throw new SyncError("not_eligible");
  if (await connectionOf(ctx, provider.id)) throw new SyncError("already_connected");
  const target = await targetOf(ctx, provider, parsedTarget.data);
  await takeKeyAttempt(ctx, provider.id, now);

  // The network, outside any transaction: the check, the test reading, the history.
  const source = sourceOf(provider.id);
  let check: KeyCheck;
  let snapshot: HoldingsSnapshot;
  try {
    check = await source.verifyReadOnly(keys);
    if (check.result !== "read-only") throw new SyncError("not_read_only");
    snapshot = await source.fetchHoldings(
      keys,
      target.currency,
      now,
      await todayLookup(ctx, target.currency, now),
    );
  } catch (error) {
    if (!(error instanceof SyncError))
      console.error("[investments] connect failed", sourceErrorLog(provider.id, error));
    throw new SyncError(codeOf(error));
  }
  const history = await source.fetchHistory(keys, target.currency, now).catch((error: unknown) => {
    console.error("[investments] history not read", sourceErrorLog(provider.id, error));
    return null;
  });

  const todayOn = today(ctx.timeZone, now);
  const historyStart = history?.points[0]?.on ?? null;

  const connection = await saveConnection(ctx, { provider: provider.id, credentials: keys });
  try {
    await saveSchedule(ctx, connection.id, PROVIDER_SCHEDULE, now);
    const accountId = await getDb().transaction(async (tx) => {
      let investment: InvestmentAccount;
      let from: CivilDate;
      if (target.kind === "adopt") {
        from = historyStart ?? todayOn;
        await openedNoLaterThan(ctx, target.accountId, from, tx);
        [investment] = await tx
          .insert(investmentAccounts)
          .values(
            userScoped(ctx).stamp({
              accountId: target.accountId,
              category: provider.category,
              provider: provider.id,
              managedSince: from,
              openedOn: from,
            }),
          )
          .returning();
      } else if (target.kind === "handover") {
        from = todayOn;
        [investment] = await tx
          .insert(investmentAccounts)
          .values(
            userScoped(ctx).stamp({
              accountId: target.accountId,
              category: provider.category,
              provider: provider.id,
              managedSince: from,
              openedOn: from,
            }),
          )
          .returning();
        await takeOver(ctx, target.accountId, from, tx);
      } else {
        // Manual → synced (§2.5): from the latest of its own periods, or of the history if later.
        investment = await lockInvestmentAccount(ctx, target.accountId, tx);
        const book = await loadBook(ctx, investment, target.currency, tx);
        const last = book.periodRows.at(-1)?.fromOn ?? todayOn;
        from = historyStart !== null && historyStart > last ? historyStart : last;
        [investment] = await tx
          .update(investmentAccounts)
          .set({ provider: provider.id, managedSince: from, updatedAt: now })
          .where(and(eq(investmentAccounts.id, investment.id), userScoped(ctx).owns(investmentAccounts)))
          .returning();
        // A manual service wrote nothing (PERS-342): from `from` the provider is the one writer.
        await takeOver(ctx, target.accountId, from, tx);
      }
      await tx.insert(investmentAccountPeriods).values(
        userScoped(ctx).stamp({
          investmentAccountId: investment.id,
          fromOn: from,
          startsAt: target.kind === "adopt" ? new Date(`${from}T00:00:00Z`) : now,
          mode: "assets" as const,
          origin: "synced" as const,
          reason:
            target.kind === "adopt"
              ? ("opening" as const)
              : target.kind === "handover"
                ? ("handover" as const)
                : ("conversion" as const),
        }),
      );
      await insertKeyCheck(ctx, tx, {
        investmentAccountId: investment.id,
        connectionId: connection.id,
        provider: provider.id,
        origin: "connect",
        check,
        now,
      });
      const scopes = snapshot.scopes;
      for (const point of history?.points ?? []) {
        if (point.on < from || point.on >= todayOn) continue;
        await writeReading(ctx, tx, investment, {
          on: point.on,
          observedAt: new Date(`${point.on}T23:59:59Z`),
          status: point.totalCents === 0n ? "confirmed_zero" : "complete",
          totalCents: point.totalCents,
          cashCents: null,
          externalAccountId: snapshot.externalAccountId,
          snapshot: null,
          scopes: scopes.map((scope) => ({ product: scope.product, complete: true })),
        });
      }
      if (history) await writeCoverage(ctx, tx, connection.id, "holdings", history.coverage);
      await writeReading(ctx, tx, investment, {
        on: todayOn,
        observedAt: snapshot.observedAt,
        status: await statusOf(ctx, tx, investment, snapshot, todayOn),
        totalCents: snapshot.totalCents,
        cashCents: snapshot.cashCents,
        externalAccountId: snapshot.externalAccountId,
        snapshot,
        scopes,
      });
      await rebuild(ctx, investment, target.currency, from, tx);
      return investment.accountId;
    });
    // The first flows now, so the page has its history at once; a failure waits for the next pass.
    if (queueFlows) await queueFlows(connection.id, accountId);
    else await readFirstFlows(ctx, connection, accountId, now);
    return { accountId, ipRestricted: check.ipRestricted };
  } catch (error) {
    // Nothing half done: without its account a key stays nowhere.
    await deleteConnection(ctx, connection.id).catch(() => undefined);
    throw error;
  }
}

/**
 * The first flows of a service just connected, the history rebuilt from them and the 12 months
 * settled (PERS-100, PERS-145), under the connection's lock. Never throws: a failure waits for the
 * next pass.
 */
export async function readFirstFlows(
  ctx: Ctx,
  connection: Connection,
  accountId: string,
  now: Date,
): Promise<void> {
  await withJobLock(`investments-sync:${connection.id}`, async () => {
    await syncFlows(ctx, connection, accountId, now);
    const linked = await linkedOf(ctx, connection);
    if (linked) {
      await estimateHistoryOf(ctx, linked, now).catch((error: unknown) => {
        console.error("[investments] history not rebuilt", sourceErrorLog(connection.provider, error));
      });
      await settleCutoff(ctx, accountId).catch((error: unknown) => {
        console.error("[investments] cut-off not settled", sourceErrorLog(connection.provider, error));
      });
      await linkCashLegs(ctx, accountId).catch((error: unknown) => {
        console.error("[investments] legs not linked", sourceErrorLog(connection.provider, error));
      });
    }
  }).catch((error: unknown) => {
    console.error("[investments] first flows not read", sourceErrorLog(connection.provider, error));
  });
}
