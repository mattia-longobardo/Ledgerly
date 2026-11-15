/**
 * The Wallet pass (docs/scheduler.md) and what follows it: "Wallet accounts + balances; Wallet
 * transactions (then recurrences)".
 *
 * The job is the scheduler, not the engine. The engine is `platform/integrations/wallet/sync.ts`,
 * which coordinates the two modules and writes `sync_runs`; this file iterates over the users,
 * keeps one user's failure to that user (§10.1) and stores the recurrences `rules.ts` detected.
 *
 * Recurrences are persisted here rather than in `service.ts` because they are not a use case
 * anyone calls: they are derived from the movements after a pass, in this module, and `./schema` is
 * this module's own.
 */
import "server-only";
import { and, asc, eq, isNull, isNotNull, ne } from "drizzle-orm";
import { forEachUser, type Person } from "@/modules/users/jobs";
import { redactForLog } from "@/platform/auth/logger";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { Connection } from "@/platform/integrations/service";
import { BACKFILL_CHOICES, backfillDepth } from "@/platform/integrations/wallet/depth";
import { isSyncBusy, syncWalletNow } from "@/platform/integrations/wallet/sync";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@/platform/jobs/schema";
import { type RecurrenceInput, detectRecurrences } from "./rules";
import { recurringPatterns, transactions } from "./schema";
import { linkOwnTransfers } from "./service";

/* Recurrences (spec §7.2) */

/**
 * The recurring patterns of one user, recomputed from their own movements and stored as the whole
 * truth: what is no longer detected is deleted, so a series a person hid or a payee that stopped
 * billing does not linger as a pattern nobody can explain.
 *
 * The read is narrowed to the rows that could possibly take part — visible, not a transfer, with a
 * payee — which is the same predicate `detectRecurrences` applies again in memory: the filter is
 * there to bound the query, not to decide anything. `nextExpectedOn` and `lastSeenOn` arrive as
 * civil dates from the rule, which measured them in the user's own zone.
 */
export async function refreshRecurrences(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  now: Date = new Date(),
): Promise<number> {
  const rows = await getDb()
    .select({
      occurredAt: transactions.occurredAt,
      amountCents: transactions.amountCents,
      currency: transactions.currency,
      payee: transactions.payee,
      type: transactions.type,
      transferGroupId: transactions.transferGroupId,
      hiddenAt: transactions.hiddenAt,
      removedUpstreamAt: transactions.removedUpstreamAt,
    })
    .from(transactions)
    .where(
      and(
        userScoped(ctx).owns(transactions),
        isNull(transactions.hiddenAt),
        isNull(transactions.removedUpstreamAt),
        isNull(transactions.transferGroupId),
        isNotNull(transactions.payee),
        ne(transactions.type, "transfer"),
      ),
    )
    .orderBy(asc(transactions.occurredAt), asc(transactions.id));

  const detected = detectRecurrences(rows as RecurrenceInput[], ctx.timeZone);
  const keep = new Set(detected.map((one) => JSON.stringify([one.payeeKey, one.currency, one.sign])));

  const stored = await getDb()
    .select({
      id: recurringPatterns.id,
      payeeKey: recurringPatterns.payeeKey,
      currency: recurringPatterns.currency,
      sign: recurringPatterns.sign,
    })
    .from(recurringPatterns)
    .where(userScoped(ctx).owns(recurringPatterns))
    .orderBy(asc(recurringPatterns.id));
  const stale = stored
    .filter((row) => !keep.has(JSON.stringify([row.payeeKey, row.currency, row.sign])))
    .map((row) => row.id);

  if (detected.length === 0 && stale.length === 0) return 0;
  await getDb().transaction(async (tx) => {
    for (const pattern of detected) {
      const values = {
        intervalDays: pattern.intervalDays,
        medianCents: pattern.medianCents,
        occurrences: pattern.occurrences,
        lastSeenOn: pattern.lastSeenOn,
        nextExpectedOn: pattern.nextExpectedOn,
        updatedAt: now,
      };
      await tx
        .insert(recurringPatterns)
        .values(
          userScoped(ctx).stamp({
            payeeKey: pattern.payeeKey,
            currency: pattern.currency,
            sign: pattern.sign,
            ...values,
          }),
        )
        .onConflictDoUpdate({
          target: [
            recurringPatterns.userId,
            recurringPatterns.payeeKey,
            recurringPatterns.currency,
            recurringPatterns.sign,
          ],
          set: values,
        });
    }
    for (const id of stale) {
      await tx
        .delete(recurringPatterns)
        .where(and(eq(recurringPatterns.id, id), userScoped(ctx).owns(recurringPatterns)));
    }
  });
  return detected.length;
}

/* The job */

/** What one pass of one connection amounted to, as the integrations dispatcher counts it. */
type SyncOutcome =
  /** The provider was asked something, and answered. */
  | "answered"
  /** The pass failed: the provider refused, broke, or came back in a shape we would not trust. */
  | "failed"
  /** Nothing was attempted: the credential is already refused, so no call was made. */
  | "refused";

/** What became of one Wallet pass, as the integrations dispatcher counts it. */
export type WalletPassOutcome = SyncOutcome | "busy";

/** How far back the Wallet history is read: the depths a person can ask for, and the one a cursor holds. */
export const WALLET_HISTORY = { choices: BACKFILL_CHOICES, depthOf: backfillDepth };

/**
 * One Wallet pass for one person. Called by the integrations dispatcher
 * (`platform/integrations/jobs.ts`) when the connection's own schedule says it is due
 * (docs/auth-design.md D7); the dispatcher sends the warnings that follow a pass, for every
 * provider alike (`platform/integrations/alerts.ts`).
 *
 * A sync that fails is caught here: the engine has already written its own `sync_runs` row and
 * left the connection's health saying so. A pass already running on this connection — the owner
 * pressed "Sync now" as the tick came round — is `busy`: nothing was attempted, and the
 * dispatcher leaves the schedule where it was.
 */
export async function runWalletPass(
  _person: Person,
  ctx: Ctx,
  connection: Connection,
  now: Date = new Date(),
): Promise<WalletPassOutcome> {
  try {
    const pass = await syncWalletNow(ctx, connection.id, { now });
    // A refused credential attempts no call at all: counting it as a pass would put a connection
    // that was never contacted among the answered ones.
    return pass.refused !== null ? "refused" : "answered";
  } catch (error) {
    if (isSyncBusy(error)) return "busy";
    console.error("[integrations-sync] the Wallet pass failed", redactForLog(error));
    return "failed";
  }
}

/**
 * For every user: own transfers linked, then the recurrences recomputed from what is stored. This
 * is what was left of `wallet-sync` once the Wallet pass itself moved to the integrations dispatcher
 * (D7): it runs first after a sync that changed the movements (`runAfterSync`), so the jobs behind
 * it see them.
 */
export const recurrencesRefreshJob: JobDefinition = {
  name: "recurrences-refresh",
  tier: "afterSync",
  async run(): Promise<JobDetail> {
    const now = new Date();
    let patterns = 0;
    const counts = await forEachUser("recurrences-refresh", async (_person, ctx) => {
      // Before the recurrences: a giroconto found by IBAN is no longer a candidate series.
      await linkOwnTransfers(ctx);
      patterns += await refreshRecurrences(ctx, now);
    });
    return { ...counts, recurrences: patterns };
  },
};
