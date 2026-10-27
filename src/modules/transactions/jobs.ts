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
import { forEachUser, type Person } from "@/modules/users/jobs";
import { redactForLog } from "@/platform/auth/logger";
import type { Ctx } from "@/platform/context";
import { civilDateIn } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import { formatDate, type UiLocale } from "@/platform/format";
import { DEFAULT_STALE_AFTER_HOURS, isStale } from "@/modules/accounts/rules";
import { type Connection, listConnections, listRuns } from "@/platform/integrations/service";
import { isSyncBusy, syncWalletNow } from "@/platform/integrations/wallet/sync";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@/platform/jobs/schema";
import { clearNotification, notifyOnce } from "@/platform/notifications/service";
import en from "../../../messages/en.json";
import it from "../../../messages/it.json";
import { type RecurrenceInput, detectRecurrences } from "./rules";
import { recurringPatterns, transactions } from "./schema";
import { linkOwnTransfers } from "./service";

const CATALOGUES = { en, it } as const;

/** A condition that lasts for weeks is worth one email a week, not one an hour. */
const NOTIFY_COOLDOWN_HOURS = 24 * 7;

/**
 * The two conditions of §10.4 this job reports, keyed on the connection they are about — and this
 * job is the only place either is reported. §10.4 has one "sync failed or out of date" condition,
 * and the connection is where it lives: the credential is the thing the user can fix, and one
 * dead token would otherwise send one email per account as well (see `modules/accounts/jobs.ts`,
 * which keeps its per-account staleness for the interface and mails none of it).
 */
const FAILED = "wallet_sync_failed";
const STALE = "wallet_sync_stale";

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
 * What the pass just recorded, for the email: the newest run that did not work, which carries both
 * the kind and the message `sync_runs` stored. Read back from the log rather than from the thrown
 * error so the email quotes exactly what Settings › Integrations shows.
 *
 * A `skipped` run counts here when it carries a reason, because that is what a refused credential
 * leaves behind: the engine attempts nothing for a `revoked` connection and records "token
 * rejected" instead of a failure. Without it the email would fall back to a generic kind and lose
 * the one sentence the user can act on.
 */
async function lastFailure(
  ctx: Pick<Ctx, "userId">,
  connectionId: string,
): Promise<{ kind: string; error: string } | null> {
  const runs = await listRuns(ctx, { connectionId, limit: 4 });
  const failed = runs.find(
    (run) => run.state === "failed" || (run.state === "skipped" && run.error !== null),
  );
  return failed ? { kind: failed.kind, error: failed.error ?? "" } : null;
}

/** What one pass of one connection amounted to, for the purpose of §10.4's two conditions. */
type SyncOutcome =
  /** The provider was asked something, and answered. */
  | "answered"
  /** The pass failed: the provider refused, broke, or came back in a shape we would not trust. */
  | "failed"
  /** Nothing was attempted: the credential is already refused, so no call was made. */
  | "refused";

/**
 * The two conditions of §10.4, and only ever one email at a time.
 *
 * "Failed" and "out of date" are two conditions, not two words for one, and a refused credential
 * is the first: the token was rejected, the database already knows it (`sync_runs.error`,
 * `connection.last_error`), and "the sync is out of date since <date>" would hide the one sentence
 * the user can act on behind a date they cannot fix. So a pass that failed **and** a connection
 * that attempted nothing because it is `revoked` both send the failure, with the kind and the
 * message the log holds; only a connection that is answering and merely behind the staleness
 * window (the single constant of §7.1) sends "out of date".
 *
 * A connection that is healthy again has both records cleared, so the next occurrence is reported
 * straight away instead of waiting out the cooldown.
 *
 * That leaves "out of date" a narrow condition, and deliberately so: every pass that is attempted
 * either moves `last_ok_at` (`finishRun`) or is reported as the failure it was, so what is left
 * for it is a connection nothing has attempted for longer than the window. §10.4 names the
 * condition, so it stays: it is the one that would catch a future kind that stops writing
 * `last_ok_at` without anybody failing.
 */
async function reportSync(
  person: Person,
  ctx: Ctx,
  connection: Connection,
  outcome: SyncOutcome,
  now: Date,
): Promise<boolean> {
  // `revoked` covers the pass that was refused mid-flight too: `markConnection` has already
  // written it by the time the job re-reads the connection.
  if (outcome !== "answered" || connection.state === "revoked") {
    const failure = await lastFailure(ctx, connection.id);
    return notifyOnce(
      {
        userId: person.id,
        kind: FAILED,
        key: connection.id,
        cooldownHours: NOTIFY_COOLDOWN_HOURS,
        category: "syncAlerts",
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
        category: "syncAlerts",
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

/** What became of one Wallet pass, as the integrations dispatcher counts it. */
export type WalletPassOutcome = SyncOutcome | "busy";

/**
 * One Wallet pass for one person, and the email of §10.4 that follows it. Called by the
 * integrations dispatcher (`platform/integrations/jobs.ts`) when the connection's own schedule
 * says it is due (docs/auth-design.md D7) — the cadence is the person's, no longer the hourly tier.
 *
 * A sync that fails is caught here: the engine has already written its own `sync_runs` row and
 * left the connection's health saying so. A pass already running on this connection — the owner
 * pressed "Sync now" as the tick came round — is `busy`: nothing was attempted, so there is nothing
 * to report and no email to send, and the dispatcher leaves the schedule where it was.
 */
export async function runWalletPass(
  person: Person,
  ctx: Ctx,
  connection: Connection,
  now: Date = new Date(),
): Promise<WalletPassOutcome> {
  let outcome: WalletPassOutcome = "answered";
  try {
    const pass = await syncWalletNow(ctx, connection.id, { now });
    // A refused credential attempts no call at all: counting it as a pass would put a connection
    // that was never contacted among the answered ones, and leave §10.4 with nothing but "out of
    // date" to say about a token the provider rejected.
    if (pass.refused !== null) outcome = "refused";
  } catch (error) {
    if (isSyncBusy(error)) return "busy";
    outcome = "failed";
    console.error("[integrations-sync] the Wallet pass failed", redactForLog(error));
  }
  // Re-read: `finishRun` has just written `last_ok_at` and the connection's state, and both
  // decide which of the two conditions of §10.4 applies.
  const after = (await listConnections(ctx)).find((one) => one.id === connection.id) ?? connection;
  await reportSync(person, ctx, after, outcome, now);
  return outcome;
}

/**
 * Every hour (spec §10.2), for every user: own transfers linked, then the recurrences recomputed
 * from what is stored. This is what was left of `wallet-sync` once the Wallet pass itself moved to
 * the integrations dispatcher (D7): it runs right after the dispatcher in the hourly tier, so the
 * jobs behind it (`subscriptions-check`, `budget-alerts`, `interests-accrual`) still see movements
 * an on-the-hour sync has just brought in.
 */
export const recurrencesRefreshJob: JobDefinition = {
  name: "recurrences-refresh",
  tier: "hourly",
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
