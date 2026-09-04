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
 * Rounds away binary floating-point noise (e.g. `0.0225 * 0.74 * 100` lands
 * on `1.6649999999999998`, not `1.665`) before the final display rounding, so
 * `.toFixed` rounds the intended decimal value instead of a value one ULP
 * below it.
 */
function cleanPct(n: number): number {
  return Number(n.toFixed(10));
}

function buildNote(rule: InterestRule, accrual: InterestAccrual): string {
  const ratePct = cleanPct(Number(rule.annualRate) * 100).toFixed(2);
  const netRatePct = cleanPct(Number(rule.annualRate) * (1 - Number(rule.taxRate)) * 100).toFixed(2);
  const taxPct = cleanPct(Number(rule.taxRate) * 100).toFixed(0);
  return `${rule.noteMarker} ${ratePct}%/y (net ${netRatePct}%, -${taxPct}% tax) on ${accrual.balanceBasis}`;
}

/**
 * Reuses `interest.py`'s exact note format and its "post uncategorised
 * rather than fail" behavior when the named category is not found
 * (`Wallet Manager/app/interest.py:163-164`). The only file in this task
 * that names a Wallet field.
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
