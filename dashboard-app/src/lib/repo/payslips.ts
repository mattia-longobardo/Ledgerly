/**
 * The frozen legacy payslip archive, read-only since Phase 4.
 *
 * The `payslips` table is not dropped — spec §11 Phase 9 does that — and these
 * two readers still feed `src/app/(app)/_lib/vacation.ts` (Ferie residuals) and
 * `src/app/(app)/company/time-off/page.tsx` until Phase 7 replaces them with
 * `timeoff_balances`. Every write function and every other reader lost its last
 * caller when Paperless was retired and `/work` became `/company`; they were
 * deleted rather than left as dead exports.
 */

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { payslips } from "@/lib/db/schema";

/** Only verified, non-superseded rows may feed a statistic. */
export async function verifiedPayslips() {
  return db
    .select()
    .from(payslips)
    .where(and(eq(payslips.status, "verified"), isNull(payslips.supersededBy)))
    .orderBy(asc(payslips.month));
}

export async function latestVerified() {
  const [row] = await db
    .select()
    .from(payslips)
    .where(and(eq(payslips.status, "verified"), isNull(payslips.supersededBy), eq(payslips.isThirteenth, false)))
    .orderBy(desc(payslips.month))
    .limit(1);
  return row ?? null;
}
