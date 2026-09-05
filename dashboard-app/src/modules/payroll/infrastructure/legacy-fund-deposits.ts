import { and, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { fundDeposits, funds } from "@/lib/db/schema";
import type { LegacyFundDepositInput, LegacyFundDeposits } from "../application/ports";
import { addMoney } from "../domain/money";

/**
 * The Phase-5 bridge (Ruling R4-6): an applied payroll record keeps the legacy
 * Funds page working by writing the month's `fund_deposits` row, exactly as the
 * retiring `src/app/actions/payslips.ts:upsertCometaDeposit` did.
 *
 * Two deliberate differences from that function. It runs on the **caller's
 * transaction** rather than the module-level `db`, so the deposit and the
 * payroll record commit or roll back together. And it writes `payslip_id: null`
 * — `fund_deposits.payslip_id` is a `bigint` FK to the legacy `payslips.id`,
 * and a `payroll_records` id is a uuid, so there is nothing valid to put there;
 * the provenance lives on `payroll_records` instead and Phase 5's
 * `fund_contributions` picks it up from there.
 *
 * `fund_deposits` carries no RLS (it is a legacy, single-owner table), so this
 * is one of the few writes in the module RLS does not also guard. The
 * `fundSlug` lookup is the only gate, and it fails closed: an unknown slug
 * writes nothing and says so.
 */
export function drizzleLegacyFundDeposits(tx: DbClient): LegacyFundDeposits {
  return {
    async upsertForRecord(input: LegacyFundDepositInput) {
      const [fund] = await tx.select().from(funds).where(eq(funds.slug, input.fundSlug)).limit(1);
      if (!fund) return "no_fund";
      const amount = addMoney(input.employee, input.employer);
      // Both halves absent means the payslip did not state a contribution.
      // Writing `0.00` here would put a real, wrong figure on the Funds page.
      if (amount === null) return "no_amount";
      await tx
        .insert(fundDeposits)
        .values({
          fundId: fund.id,
          month: input.month,
          amount,
          employeePart: input.employee,
          employerPart: input.employer,
          source: "payroll",
          payslipId: null,
        })
        .onConflictDoUpdate({
          target: [fundDeposits.fundId, fundDeposits.month],
          set: {
            amount,
            employeePart: input.employee,
            employerPart: input.employer,
            source: "payroll",
            payslipId: null,
          },
        });
      return "written";
    },
  };
}
