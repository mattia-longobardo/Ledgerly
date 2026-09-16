/**
 * The hourly Wallet pass (spec §10.2: every hour at minute 07) and what follows it: "Wallet
 * accounts + balances; Wallet transactions (then recurrences)".
 *
 * The job is the scheduler, not the engine. The engine is `platform/integrations/wallet/sync.ts`,
 * which coordinates the two modules and writes `sync_runs`; this file iterates over the users,
 * keeps one user's failure to that user (§10.1), turns a failed or stale sync into the email of
 * §10.4, and stores the recurrences `rules.ts` detected.
 *
 * Recurrences are persisted here rather than in `service.ts` because they are not a use case
 * anyone calls: they are derived from the movements after a pass, in this module, and `./schema` is
 * this module's own.
 */
import "server-only";
import { and, asc, eq, isNull, isNotNull, ne } from "drizzle-orm";
import { createTranslator } from "use-intl/core";
import { getPreferences } from "@/modules/users/service";
import { redactForLog } from "@/platform/auth/logger";
import { users } from "@/platform/auth/schema";
import type { Ctx } from "@/platform/context";
import { civilDateIn } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import { formatDate, type UiLocale } from "@/platform/format";
import { DEFAULT_STALE_AFTER_HOURS, isStale } from "@/modules/accounts/rules";
import { type Connection, listConnections, listRuns } from "@/platform/integrations/service";
import { WALLET_PROVIDER } from "@/platform/integrations/rules";
import { syncWalletNow } from "@/platform/integrations/wallet/sync";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@/platform/jobs/schema";
import { clearNotification, notifyOnce } from "@/platform/notifications/service";
import en from "../../../messages/en.json";
import it from "../../../messages/it.json";
import { type RecurrenceInput, detectRecurrences } from "./rules";
import { recurringPatterns, transactions } from "./schema";

const CATALOGUES = { en, it } as const;

/** A condition that lasts for weeks is worth one email a week, not one an hour. */
const NOTIFY_COOLDOWN_HOURS = 24 * 7;

/** The two conditions of §10.4 this job reports, keyed on the connection they are about. */
const FAILED = "wallet_sync_failed";
const STALE = "wallet_sync_stale";

interface Person {
  id: string;
  email: string;
}

/* Iterating over the users — the same shape as `modules/accounts/jobs.ts` (spec §10.1). */

async function everyone(): Promise<Person[]> {
  return getDb().select({ id: users.id, email: users.email }).from(users).orderBy(asc(users.id));
}

async function contextFor(person: Person): Promise<Ctx> {
  const preferences = await getPreferences({ userId: person.id });
  return {
    userId: person.id,
    role: "user",
    locale: preferences.locale,
    timeZone: preferences.timeZone,
    numberFormat: preferences.numberFormat,
  };
}

async function forEachUser(
  job: string,
  body: (person: Person, ctx: Ctx) => Promise<void>,
): Promise<{ users: number; failed: number }> {
  let failed = 0;
  const people = await everyone();
  for (const person of people) {
    try {
      await body(person, await contextFor(person));
    } catch (error) {
      failed += 1;
      console.error(`[${job}] failed for one user`, redactForLog(error));
    }
  }
  return { users: people.length, failed };
}

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

/* Notifications (spec §10.4) */

function syncMail(
  condition: "failed" | "stale",
  locale: UiLocale,
  values: Record<string, string>,
): { subject: string; text: string } {
  const t = createTranslator({
    locale,
    messages: CATALOGUES[locale],
    namespace: "settings.integrations.notifications",
  });
  return condition === "failed"
    ? { subject: t("failedSubject"), text: t("failedBody", values) }
    : { subject: t("staleSubject"), text: t("staleBody", values) };
}

/**
 * What the pass just recorded, for the email: the newest run that failed, which carries both the
 * kind and the message `sync_runs` stored. Read back from the log rather than from the thrown
 * error so the email quotes exactly what Settings › Integrations shows.
 */
async function lastFailure(
  ctx: Pick<Ctx, "userId">,
  connectionId: string,
): Promise<{ kind: string; error: string } | null> {
  const runs = await listRuns(ctx, { connectionId, limit: 4 });
  const failed = runs.find((run) => run.state === "failed");
  return failed ? { kind: failed.kind, error: failed.error ?? "" } : null;
}

/**
 * The two conditions of §10.4, and only ever one email at a time: a sync that just failed says
 * why, and one that has not succeeded for longer than the staleness window (the single constant of
 * §7.1) says since when — a `revoked` connection, which attempts nothing, is exactly that case. A
 * connection that is healthy again has both records cleared, so the next occurrence is reported
 * straight away instead of waiting out the cooldown.
 */
async function reportSync(
  person: Person,
  ctx: Ctx,
  connection: Connection,
  failed: boolean,
  now: Date,
): Promise<boolean> {
  if (failed) {
    const failure = await lastFailure(ctx, connection.id);
    return notifyOnce(
      {
        userId: person.id,
        kind: FAILED,
        key: connection.id,
        cooldownHours: NOTIFY_COOLDOWN_HOURS,
        mail: {
          to: person.email,
          ...syncMail("failed", ctx.locale, {
            kind: failure?.kind ?? "wallet",
            error: failure?.error ?? connection.lastError ?? "",
          }),
        },
      },
      now,
    );
  }

  const lastOkAt = connection.lastOkAt;
  if (isStale(lastOkAt, DEFAULT_STALE_AFTER_HOURS, now)) {
    return notifyOnce(
      {
        userId: person.id,
        kind: STALE,
        key: connection.id,
        cooldownHours: NOTIFY_COOLDOWN_HOURS,
        mail: {
          to: person.email,
          // No successful sync at all yet: the honest "since" is when the connection was saved.
          // The user's own civil date, written in their language, and no new message key for it.
          ...syncMail("stale", ctx.locale, {
            since: formatDate(
              civilDateIn(lastOkAt ?? connection.createdAt, ctx.timeZone),
              "long",
              ctx.locale,
            ),
          }),
        },
      },
      now,
    );
  }

  await clearNotification(person.id, FAILED, connection.id);
  await clearNotification(person.id, STALE, connection.id);
  return false;
}

/* The job */

/**
 * Every hour at minute 07 (spec §10.2): each user's Wallet connection, then their recurrences.
 *
 * A user with no connection is not an error and not a skipped sync — there is simply nothing to
 * read — but their recurrences are still refreshed, because they are derived from what is already
 * stored. A sync that fails is caught here: the engine has already written its own `sync_runs` row
 * and left the connection's health saying so, and the pass continues to the recurrences rather
 * than losing them to a provider's bad afternoon.
 */
export const walletSyncJob: JobDefinition = {
  name: "wallet-sync",
  tier: "hourly",
  async run(): Promise<JobDetail> {
    const now = new Date();
    let connections = 0;
    let passes = 0;
    let failures = 0;
    let notified = 0;
    let patterns = 0;

    const counts = await forEachUser("wallet-sync", async (person, ctx) => {
      const connection = (await listConnections(ctx)).find((one) => one.provider === WALLET_PROVIDER);
      if (connection) {
        connections += 1;
        let failed = false;
        try {
          await syncWalletNow(ctx, connection.id, { now });
          passes += 1;
        } catch (error) {
          failed = true;
          failures += 1;
          console.error("[wallet-sync] the Wallet pass failed", redactForLog(error));
        }
        // Re-read: `finishRun` has just written `last_ok_at` and the connection's state, and both
        // decide which of the two conditions of §10.4 applies.
        const after = (await listConnections(ctx)).find((one) => one.id === connection.id) ?? connection;
        if (await reportSync(person, ctx, after, failed, now)) notified += 1;
      }
      patterns += await refreshRecurrences(ctx, now);
    });

    return { ...counts, connections, passes, failures, notified, recurrences: patterns };
  },
};
