import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { type Db, getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import type { Cents } from "../../../shared/money";
import { COUNTRY_FIELDS, DEFAULT_EMPLOYER, type Employer, employerInputSchema } from "../rules";
import { payrollEmployers, payslipFields } from "../schema";
import { PayrollError } from "./codes";

// ——— The fields of the country as pairs (R5g, E4) ———

/** A payslip's pairs, by key. */
export type Pairs = Record<string, Cents>;

/**
 * Writes a payslip's pairs: one for every field of the catalogue with a value, none for the others.
 * `values` may hold any field; the ones no pack has are not stored.
 */
export async function writePairs(
  ctx: Pick<Ctx, "userId">,
  payslipId: string,
  values: Readonly<Record<string, Cents | null | undefined>>,
  transaction: Tx,
): Promise<void> {
  await transaction
    .delete(payslipFields)
    .where(and(eq(payslipFields.payslipId, payslipId), userScoped(ctx).owns(payslipFields)));
  const rows = COUNTRY_FIELDS.flatMap(({ key }) => {
    const value = values[key];
    return value === null || value === undefined ? [] : [userScoped(ctx).stamp({ payslipId, key, valueCents: value })];
  });
  if (rows.length > 0) await transaction.insert(payslipFields).values(rows);
}

/** The pairs of some payslips, by payslip. */
export async function pairsOf(
  ctx: Pick<Ctx, "userId">,
  payslipIds: readonly string[],
  executor: Db | Tx = getDb(),
): Promise<Map<string, Pairs>> {
  const result = new Map<string, Pairs>();
  if (payslipIds.length === 0) return result;
  const rows = await executor
    .select({ payslipId: payslipFields.payslipId, key: payslipFields.key, valueCents: payslipFields.valueCents })
    .from(payslipFields)
    .where(and(userScoped(ctx).owns(payslipFields), inArray(payslipFields.payslipId, [...payslipIds])))
    .orderBy(asc(payslipFields.payslipId), asc(payslipFields.key));
  for (const row of rows) result.set(row.payslipId, { ...result.get(row.payslipId), [row.key]: row.valueCents });
  return result;
}

// ——— The employer (R5g, E6) ———

/** The person's employer as configured; the default of the rules when they never said. */
export async function employerOf(ctx: Pick<Ctx, "userId">): Promise<Employer & { configured: boolean }> {
  const [row] = await getDb()
    .select({ payFrequency: payrollEmployers.payFrequency, extraMonths: payrollEmployers.extraMonths })
    .from(payrollEmployers)
    .where(userScoped(ctx).owns(payrollEmployers));
  return row ? { ...row, configured: true } : { ...DEFAULT_EMPLOYER, extraMonths: [...DEFAULT_EMPLOYER.extraMonths], configured: false };
}

/** Saves how the employer pays: the frequency and the month of each extra payment, in order. */
export async function saveEmployer(ctx: Pick<Ctx, "userId">, input: unknown): Promise<Employer & { configured: boolean }> {
  const parsed = employerInputSchema.safeParse(input);
  if (!parsed.success) throw new PayrollError("invalid_value");
  const values = { payFrequency: parsed.data.payFrequency, extraMonths: parsed.data.extraMonths };
  await getDb()
    .insert(payrollEmployers)
    .values(userScoped(ctx).stamp(values))
    .onConflictDoUpdate({ target: payrollEmployers.userId, set: { ...values, updatedAt: sql`now()` } });
  return { ...values, configured: true };
}
