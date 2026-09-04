import { getCategories, postRecords } from "@/lib/clients/wallet";
import type { InterestAccrual, InterestRule } from "../application/ports";

export const WALLET_PROVIDER = "wallet";

export interface PostWalletInterestInput {
  token: string;
  walletAccountId: string;
  rule: InterestRule;
  accrual: InterestAccrual;
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
 */
/**
 * Rounds away binary floating-point noise (e.g. `0.0225 * 0.74 * 100` lands
 * on `1.6649999999999998`, not `1.665`) before the final display rounding, so
 * `.toFixed` rounds the intended decimal value instead of a value one ULP
 * below it.
 */
function cleanPct(n: number): number {
  return Number(n.toFixed(10));
}

export async function postWalletInterestEntry(input: PostWalletInterestInput): Promise<{ note: string }> {
  const categories = await getCategories({ token: input.token });
  const wanted = (input.rule.providerCategoryRef ?? "Interest, dividends").trim().toLowerCase();
  const category = categories.find((c) => c.name.trim().toLowerCase() === wanted);

  const ratePct = cleanPct(Number(input.rule.annualRate) * 100).toFixed(2);
  const netRatePct = cleanPct(Number(input.rule.annualRate) * (1 - Number(input.rule.taxRate)) * 100).toFixed(2);
  const taxPct = cleanPct(Number(input.rule.taxRate) * 100).toFixed(0);
  const note = `${input.rule.noteMarker} ${ratePct}%/y (net ${netRatePct}%, -${taxPct}% tax) on ${input.accrual.balanceBasis}`;

  await postRecords({ token: input.token }, [
    {
      accountId: input.walletAccountId,
      amount: Number(input.accrual.net),
      recordDate: `${input.accrual.accrualDate}T00:00:00Z`,
      note,
      ...(category ? { categoryId: category.id } : {}),
    },
  ]);
  return { note };
}
