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
 * Built from the accrual's own stored figures (`gross`, `tax`, `net`,
 * `balanceBasis`) rather than the rule's *current* `annualRate`/`taxRate`.
 * The rule is mutable — a rate can be edited any time after an accrual was
 * computed under a different one — so asserting "X%/y" at post time would
 * describe whatever the rule says *now*, not what actually produced this
 * amount. The accrual's own numbers are what was actually computed and
 * cannot drift after the fact; stating them plainly is always true.
 */
function buildNote(rule: InterestRule, accrual: InterestAccrual): string {
  const gross = Number(accrual.gross).toFixed(2);
  const tax = Number(accrual.tax).toFixed(2);
  return `${rule.noteMarker} gross ${gross}, tax ${tax}, net ${accrual.net} on ${accrual.balanceBasis}`;
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
 * state (`accrual.postedAt`) is the primary idempotency guard, but a crash
 * between a previous run's successful `postRecords` call and its local
 * `markPosted` write leaves local state saying "not yet posted" even though
 * Wallet already has the record; asking Wallet directly closes that window
 * without ever sending the interest twice.
 *
 * That check is scoped by `noteMarker`, not by rule — the query only knows
 * "an account, a day, a substring of the note", and `noteMarker` defaults to
 * the same value (`auto-interest`) for every rule. Two `post_to_provider`
 * rules on the same account posting the same day, or a user's own record
 * whose note happens to contain the marker, would otherwise match a record
 * that is not this accrual's, and this accrual would get marked posted
 * against someone else's Wallet record — a silent under-post (this
 * accrual's interest is never actually sent) plus a false "posted" row. The
 * amount is checked before trusting a match for exactly this reason: it is
 * not proof of ownership, but a mismatch is proof of *non*-ownership, and
 * that is thrown as a loud failure rather than accepted.
 *
 * `postRecords` is called with `attempts: 1`: a write must not retry on the
 * same terms as a read. `withRetry`'s default policy retries on 409 and any
 * 5xx, but on a write endpoint a 409 usually means "this already exists", and
 * a 5xx can just as easily mean "the write landed, only the acknowledgement
 * didn't" — resubmitting the identical body in either case is how the same
 * interest gets posted twice. A single failed attempt here is reported as a
 * failure and left for the next scheduled run (which will find the record
 * via `findPostedRecord` if it did in fact land) rather than silently retried
 * against a financial API.
 */
export async function postWalletInterestEntry(input: PostWalletInterestInput): Promise<PostWalletInterestResult> {
  const note = buildNote(input.rule, input.accrual);

  const existing = await findPostedRecord({
    token: input.token,
    accountId: input.walletAccountId,
    recordDate: input.accrual.accrualDate,
    noteContains: input.rule.noteMarker,
  });
  if (existing) {
    const expectedAmount = Number(input.accrual.net);
    if (Math.abs(existing.amount - expectedAmount) > AMOUNT_MATCH_EPSILON) {
      throw new Error(
        `Wallet already has a record dated ${input.accrual.accrualDate} on account ${input.walletAccountId} whose note contains "${input.rule.noteMarker}" (record ${existing.id}, amount ${existing.amount}), but that does not match this accrual's net (${expectedAmount}) — refusing to mark this accrual posted against what is very likely a different rule's or a user's own record`,
      );
    }
    return { note: existing.note ?? note, transactionId: existing.id };
  }

  const categories = await getCategories({ token: input.token });
  const wanted = (input.rule.providerCategoryRef ?? "Interest, dividends").trim().toLowerCase();
  const category = categories.find((c) => c.name.trim().toLowerCase() === wanted);

  const [created] = await postRecords({ token: input.token, attempts: 1 }, [
    {
      accountId: input.walletAccountId,
      amount: Number(input.accrual.net),
      recordDate: `${input.accrual.accrualDate}T00:00:00Z`,
      note,
      ...(category ? { categoryId: category.id } : {}),
    },
  ]);
  return { note, transactionId: created?.id ?? null };
}
