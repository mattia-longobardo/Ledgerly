import type { InterestAccrual, InterestEntry, InterestRule, UseCaseDeps } from "./ports";

/** The rule's own switch, our own ledger as the idempotency source of truth, and the legacy script's "never post a zero" rule — all three, not just one. */
export function shouldPost(rule: InterestRule, accrual: InterestAccrual): boolean {
  return rule.postingMode === "post_to_provider" && accrual.postedAt === null && Number(accrual.net) > 0;
}

/**
 * Records a Wallet post that has already happened: creates the `paid`
 * `InterestEntry` and marks the accrual posted, both in the same transaction
 * the caller opened (see `tryPost` in `src/lib/jobs/interest-accrual.ts`), so
 * the two either both land or neither does.
 *
 * `markPosted` reports whether it actually matched a row (Task 16's carried
 * review finding: it used to silently no-op on a wrong id and both the fake
 * and the Drizzle repository reported success regardless). If it reports
 * `false` here, the entry we just created describes a Wallet post that our
 * own ledger cannot mark as posted — that is a failure, not a successful
 * post: throwing rolls back the entry we just created (same transaction) and
 * surfaces the problem instead of leaving `shouldPost` free to fire again on
 * the next run believing nothing has posted yet.
 */
export function recordPostedEntry(deps: UseCaseDeps) {
  return async (
    rule: InterestRule,
    accrual: InterestAccrual,
    postedNote: string,
    transactionId: string | null = null,
  ): Promise<InterestEntry> => {
    const entry = await deps.entries.create({
      userId: rule.userId,
      accountId: rule.accountId,
      occurredAt: new Date(`${accrual.accrualDate}T00:00:00Z`),
      gross: Number(accrual.gross).toFixed(2),
      net: accrual.net,
      kind: "paid",
      // The Wallet record's own id, when the posting adapter could determine
      // one — either from a fresh POST's response or from an existing record
      // found via `findPostedRecord`'s crash-recovery check — for later
      // reconciliation against Wallet. `null` when the response shape didn't
      // match anything recognised (the POST response has never been verified
      // against a live token).
      transactionId,
      ruleId: rule.id,
      source: "provider",
    });
    const affected = await deps.accruals.markPosted(accrual.id, entry.id, deps.clock.now());
    if (!affected) {
      throw new Error(
        `markPosted affected no row for interest accrual ${accrual.id} (rule ${rule.id}): a Wallet post already happened and interest entry ${entry.id} was created for it, but the accrual could not be marked posted. Treat this as a failed post, not a successful one, and reconcile manually before the next run re-posts the same interest.`,
      );
    }
    await deps.audit({
      actorUserId: rule.userId,
      action: "interests.posted",
      entityType: "interest_rule",
      entityId: rule.id,
      after: { accrualDate: accrual.accrualDate, net: accrual.net, note: postedNote },
    });
    return entry;
  };
}
