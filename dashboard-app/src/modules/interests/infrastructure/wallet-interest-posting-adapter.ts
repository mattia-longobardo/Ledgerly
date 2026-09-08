import { findPostedRecord, getCategories, postRecords } from "@/lib/clients/wallet";
import type { InterestAccrual, InterestRule } from "../application/ports";

export const WALLET_PROVIDER = "wallet";

export interface PostWalletInterestInput {
  token: string;
  walletAccountId: string;
  rule: InterestRule;
  accrual: InterestAccrual;
}

export interface PostWalletInterestResult {
  note: string;
  /** The Wallet record's own id, when known — lands on `interest_entries.transactionId` for later reconciliation. `null` when the response shape didn't match anything recognised. */
  transactionId: string | null;
}

/**
 * Ruling P3-C39 / B8: thrown *only* when the actual money-moving call
 * (`postRecords`) itself fails. That failure is genuinely ambiguous — a 5xx
 * or a dropped connection can mean "nothing happened" or "it landed and only
 * the acknowledgement didn't" — so the caller (`tryPost` in
 * `src/lib/jobs/interest-accrual.ts`) must not release this accrual's
 * posting claim on this error, and must page loudly. Every other failure out
 * of `postWalletInterestEntry` (a `findPostedRecord`/`getCategories` read, or
 * the amount-mismatch guard below) happens strictly *before* any write is
 * attempted — unambiguously safe to release the claim and retry later,
 * exactly the distinction B8 draws between "a Wallet read failed" and "money
 * may already be at Wallet".
 */
export class WalletPostAmbiguousError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WalletPostAmbiguousError";
  }
}

/**
 * Built from the accrual's own stored `net`/`balanceBasis` rather than the
 * rule's *current* `annualRate`/`taxRate`. The rule is mutable — a rate can
 * be edited any time after an accrual was computed under a different one —
 * so asserting "X%/y" at post time would describe whatever the rule says
 * *now*, not what actually produced this amount.
 *
 * Deliberately states only `net` and `balanceBasis`, not `gross`/`tax`:
 * `gross` and `tax` are stored at 6-decimal precision and `net` is the
 * *rounded*, carry-adjusted cent amount actually posted — `gross - tax`
 * does not equal `net` to the cent (the difference is the day's sub-cent
 * carry, `accrual.carryAfter`, rolled into the next day's accrual rather
 * than shown here). Displaying all three invites an operator to check that
 * the note's own arithmetic reconciles and find that it doesn't; `net` is
 * the only figure that matches the amount actually posted, so it's the
 * only one shown.
 *
 * Ruling P3-C41 (B4): the note carries `scopedNoteMarker`, not the rule's raw
 * `noteMarker` — see that function for why.
 */
function buildNote(rule: InterestRule, accrual: InterestAccrual): string {
  return `${scopedNoteMarker(rule)} net ${accrual.net} on ${accrual.balanceBasis}`;
}

/**
 * Ruling P3-C41 (B4): `noteMarker` defaults to the same value
 * (`"auto-interest"`) for every rule, and `findPostedRecord`'s query only
 * knows "an account, a day, a substring of the note" — nothing stops two
 * `post_to_provider` rules on the same account, posting the same day, from
 * matching *each other's* Wallet record. Suffixing the marker with the
 * rule's own id, and matching on that suffixed marker everywhere (both here,
 * in the note actually written to Wallet, and in the crash-recovery query
 * below), makes the marker unique per rule by construction — two rules can
 * never collide, and the query's substring match becomes far more selective
 * as a side effect. This was safe to change freely when it was written —
 * nothing had posted in production yet. Interests has been deployed since;
 * changing the marker shape now orphans any marker already written to Wallet,
 * so a change needs a migration of the notes, not just an edit here.
 */
function scopedNoteMarker(rule: InterestRule): string {
  return `${rule.noteMarker}:${rule.id}`;
}

/** A found record is treated as "not this accrual's" unless its amount matches to the cent (a small float-noise allowance, not a real tolerance for a different amount). */
const AMOUNT_MATCH_EPSILON = 0.005;

/**
 * Reuses `interest.py`'s "post uncategorised rather than fail" behavior
 * when the named category is not found (`Wallet Manager/app/interest.py:163-164`).
 * The only file in this task that names a Wallet field.
 *
 * No transaction is open anywhere in this function's call stack — it is
 * called only from `tryPost` in `src/lib/jobs/interest-accrual.ts`, strictly
 * between that function's read transactions and its final write transaction.
 *
 * Checks Wallet itself for an existing record before ever posting — the same
 * second line of defence `interest.py`'s own `already_posted_today` uses
 * (queried by `findPostedRecord`, matching its exact filter shape). Local
 * state (`accrual.postedAt`, claimed via `InterestAccrualsRepository.claimForPosting`
 * before this function is ever called — Ruling P3-C39) is the primary
 * idempotency guard, but a crash between a previous run's successful
 * `postRecords` call and its local confirm write leaves local state saying
 * "claimed, not yet confirmed" even though Wallet already has the record;
 * asking Wallet directly closes that window without ever sending the
 * interest twice.
 *
 * That check is scoped by the per-rule `scopedNoteMarker`, not the raw
 * `noteMarker` (Ruling P3-C41, B4) — see that function's own doc for why a
 * bare `rule.noteMarker` used to let two rules match each other's record.
 * The amount is still checked before trusting a match: it is not proof of
 * ownership, but a mismatch is proof of *non*-ownership, and that is thrown
 * as a loud (but unambiguous — no write was ever attempted) failure rather
 * than accepted.
 *
 * `postRecords` is called with `attempts: 1`: a write must not retry on the
 * same terms as a read. `withRetry`'s default policy retries on 409 and any
 * 5xx, but on a write endpoint a 409 usually means "this already exists", and
 * a 5xx can just as easily mean "the write landed, only the acknowledgement
 * didn't" — resubmitting the identical body in either case is how the same
 * interest gets posted twice. A single failed attempt here is reported as a
 * `WalletPostAmbiguousError` (Ruling P3-C39, B2) — left for an operator to
 * reconcile, since the accrual's posting claim is deliberately *not*
 * released for this failure — rather than silently retried against a
 * financial API.
 *
 * The `recordDate` sent to `postRecords` — and the day queried by
 * `findPostedRecord` — is the bare `accrual.accrualDate` ("YYYY-MM-DD"), not
 * a midnight timestamp (Ruling P3-C40, B1): the write used to send
 * `${accrualDate}T00:00:00Z` while the crash-recovery read queried
 * `recordDate=eq.<day>`, and if Wallet's `recordDate` column is a timestamp
 * behind a PostgREST-shaped filter, `eq.<day>` is cast in the *Wallet
 * server's* timezone — which, if it is `Europe/Rome` like this whole stack,
 * would resolve to `<day>T22:00:00Z` the prior evening and never equal a
 * value stored as `<day>T00:00:00Z`. Posting the same bare-day grain the
 * read already used removes the timezone question entirely rather than
 * documenting it — but this has still never been verified against a live
 * Wallet token; the runbook's cut-over section requires that verification
 * before any rule is first flipped to `post_to_provider`.
 */
export async function postWalletInterestEntry(input: PostWalletInterestInput): Promise<PostWalletInterestResult> {
  const note = buildNote(input.rule, input.accrual);
  const marker = scopedNoteMarker(input.rule);

  const existing = await findPostedRecord({
    token: input.token,
    accountId: input.walletAccountId,
    recordDate: input.accrual.accrualDate,
    noteContains: marker,
  });
  if (existing) {
    const expectedAmount = Number(input.accrual.net);
    if (Math.abs(existing.amount - expectedAmount) > AMOUNT_MATCH_EPSILON) {
      throw new Error(
        `Wallet already has a record dated ${input.accrual.accrualDate} on account ${input.walletAccountId} whose note contains "${marker}" (record ${existing.id}, amount ${existing.amount}), but that does not match this accrual's net (${expectedAmount}) — refusing to mark this accrual posted against what is very likely a different rule's or a user's own record`,
      );
    }
    return { note: existing.note ?? note, transactionId: existing.id };
  }

  const categories = await getCategories({ token: input.token });
  const wanted = (input.rule.providerCategoryRef ?? "Interest, dividends").trim().toLowerCase();
  const category = categories.find((c) => c.name.trim().toLowerCase() === wanted);

  let created;
  try {
    [created] = await postRecords({ token: input.token, attempts: 1 }, [
      {
        accountId: input.walletAccountId,
        amount: input.accrual.net,
        recordDate: input.accrual.accrualDate,
        note,
        ...(category ? { categoryId: category.id } : {}),
      },
    ]);
  } catch (err) {
    throw new WalletPostAmbiguousError(
      `Wallet POST failed for accrual ${input.accrual.id} (rule ${input.rule.id}) — the write may or may not have landed at Wallet: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  return { note, transactionId: created?.id ?? null };
}
