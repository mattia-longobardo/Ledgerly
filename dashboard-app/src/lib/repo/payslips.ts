import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { payslips } from "@/lib/db/schema";
import type { PayslipExtraction } from "@/lib/contracts";

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

export async function pendingVerification() {
  return db
    .select()
    .from(payslips)
    .where(eq(payslips.status, "parsed"))
    .orderBy(asc(payslips.month));
}

export async function allPayslips() {
  return db.select().from(payslips).orderBy(desc(payslips.month), asc(payslips.isThirteenth));
}

export async function payslipById(id: number) {
  const [row] = await db.select().from(payslips).where(eq(payslips.id, id)).limit(1);
  return row ?? null;
}

export async function knownDocIds(): Promise<number[]> {
  const rows = await db.selectDistinct({ id: payslips.paperlessDocId }).from(payslips);
  return rows.map((r) => r.id);
}

/** Discovery is idempotent: a re-seen document is a no-op, never a duplicate. */
export async function discover(paperlessDocId: number, month: string, isThirteenth = false) {
  const [row] = await db
    .insert(payslips)
    .values({ paperlessDocId, month, isThirteenth, status: "discovered" })
    .onConflictDoNothing({ target: [payslips.paperlessDocId, payslips.isThirteenth] })
    .returning();
  return row ?? null;
}

export async function storeExtraction(id: number, extraction: PayslipExtraction) {
  const f = extraction.fields;
  const num = (v: number | null | undefined) => (v === null || v === undefined ? null : String(v));
  const [row] = await db
    .update(payslips)
    .set({
      status: "parsed",
      rawExtraction: extraction,
      isThirteenth: extraction.isThirteenth,
      gross: num(f.gross?.value),
      net: num(f.net?.value),
      taxes: num(f.taxes?.value),
      fundContribEmployee: num(f.fundContribEmployee?.value),
      fundContribEmployer: num(f.fundContribEmployer?.value),
      ferieBalance: num(f.ferieBalance?.value),
      ferieUnit: "hours",
      rolBalance: num(f.rolBalance?.value),
      ferieTaken: num(f.ferieTakenHours?.value),
      rolTaken: num(f.rolTakenHours?.value),
      rolUnit: "hours",
    })
    .where(eq(payslips.id, id))
    .returning();
  return row ?? null;
}

/**
 * The human gate. `corrections` keeps extracted-vs-corrected per field — a
 * labelled dataset for tuning the parser, kept separate from the raw extraction
 * so neither overwrites the other.
 */
export async function verify(
  id: number,
  values: {
    gross: string | null;
    net: string | null;
    taxes: string | null;
    fundContribEmployee: string | null;
    fundContribEmployer: string | null;
    ferieBalance: string | null;
    rolBalance: string | null;
    ferieTaken: string | null;
    rolTaken: string | null;
    isThirteenth: boolean;
  },
  corrections: Record<string, { extracted: unknown; corrected: unknown }>,
) {
  const [row] = await db
    .update(payslips)
    .set({
      ...values,
      ferieUnit: "hours",
      rolUnit: "hours",
      corrections,
      status: "verified",
      verifiedAt: new Date(),
    })
    .where(eq(payslips.id, id))
    .returning();
  return row ?? null;
}

export async function reject(id: number) {
  const [row] = await db
    .update(payslips)
    .set({ status: "rejected" })
    .where(eq(payslips.id, id))
    .returning();
  return row ?? null;
}

/** Re-parsing never overwrites confirmed values: the old row is superseded. */
export async function supersede(oldId: number, newId: number) {
  await db
    .update(payslips)
    .set({ status: "superseded", supersededBy: newId })
    .where(eq(payslips.id, oldId));
}

export async function medianNet(limit = 6): Promise<number | null> {
  const result = await db.execute<{ median: string | null }>(sql`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY net)::text AS median
    FROM (
      SELECT net FROM payslips
      WHERE status = 'verified' AND superseded_by IS NULL
        AND is_thirteenth = false AND net IS NOT NULL
      ORDER BY month DESC LIMIT ${limit}
    ) recent
  `);
  const v = result.rows[0]?.median;
  return v === null || v === undefined ? null : Number(v);
}
