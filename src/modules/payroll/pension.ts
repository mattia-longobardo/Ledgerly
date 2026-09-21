import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { type CompetenceInput, quarterOfMonth } from "@/modules/funds/pension/rules";
import type { Ctx } from "@/platform/context";
import { type Db, getDb, type Tx } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { CodeRole } from "./rules";
import { payrollRawLines, payslips } from "./schema";

/** The body codes that carry pension money (GC §8.3), by the role the code map gives them. */
export const FUND_ROLES: readonly CodeRole[] = [
  "employee_fund",
  "employee_fund_adjustment",
  "employee_fund_enrollment",
  "employer_fund",
  "employer_fund_adjustment",
  "employer_fund_enrollment",
  "tfr_contribution",
];

type PayslipRow = Pick<
  typeof payslips.$inferSelect,
  | "id"
  | "period"
  | "type"
  | "year"
  | "printedOn"
  | "employeeFundEffective"
  | "employerFundPrinted"
  | "tfrContributionLine"
  | "employeeFundEnrollment"
  | "employerFundEnrollment"
  | "employeeFundAdjustments"
  | "employerFundAdjustments"
>;

/**
 * What an applied payslip accrued for the pension fund (spec §7.7; plan F6 §3.4.2; GC §8.2–8.3),
 * from its fields as they stand — corrections included:
 * - worker = the effective quota (7101 + 8054, signs kept): a 13th carries its own net quota;
 * - employer = the printed quota (9109) only: the 13th has none, and its adjustment (8056) is kept
 *   apart, never added — December's summary already includes it (GC §8.3);
 * - TFR = the contribution line (8003) only, never the month's "TFR MESE" box: October accrued TFR
 *   but paid none into the fund (GC §8.2);
 * - enrolment (7053/7052) apart; the statistical 9110 and 7897 add nothing.
 * The quarter is the month's; a 13th belongs to the fourth. `null` when no quarter can be told.
 */
export function pensionCompetenceOf(
  payslip: PayslipRow,
  fundLineIds: readonly string[],
): CompetenceInput | null {
  const quarter =
    payslip.period !== null
      ? quarterOfMonth(payslip.period)
      : payslip.type === "thirteenth"
        ? 4
        : payslip.printedOn !== null && payslip.printedOn.startsWith(String(payslip.year))
          ? quarterOfMonth(payslip.printedOn)
          : null;
  if (quarter === null) return null;
  return {
    payslipId: payslip.id,
    payrollPeriod: payslip.period,
    payslipType: payslip.type,
    year: payslip.year,
    quarter,
    workerCents: payslip.employeeFundEffective,
    employerCents: payslip.employerFundPrinted,
    tfrCents: payslip.tfrContributionLine,
    workerEnrollmentCents: payslip.employeeFundEnrollment,
    employerEnrollmentCents: payslip.employerFundEnrollment,
    workerAdjustmentCents: payslip.employeeFundAdjustments,
    employerAdjustmentCents: payslip.employerFundAdjustments,
    sourceLineIds: [...fundLineIds],
  };
}

/** The ids of a payslip's body lines that carry pension money, by the roles of the code map. */
export async function fundLineIds(
  ctx: Pick<Ctx, "userId">,
  documentId: string,
  codeMap: ReadonlyMap<string, CodeRole>,
  executor: Db | Tx = getDb(),
): Promise<string[]> {
  const lines = await executor
    .select({ id: payrollRawLines.id, code: payrollRawLines.code })
    .from(payrollRawLines)
    .where(and(eq(payrollRawLines.documentId, documentId), userScoped(ctx).owns(payrollRawLines)))
    .orderBy(asc(payrollRawLines.position));
  return lines.filter((line) => FUND_ROLES.includes(codeMap.get(line.code) ?? "other")).map((line) => line.id);
}

/**
 * The competences of every applied payslip, for the pension fund to publish from scratch (plan F6
 * §3.4.2): at its creation and from its Settings.
 */
export async function appliedCompetences(
  ctx: Pick<Ctx, "userId">,
  codeMap: ReadonlyMap<string, CodeRole>,
): Promise<CompetenceInput[]> {
  const rows = await getDb()
    .select()
    .from(payslips)
    .where(and(userScoped(ctx).owns(payslips), eq(payslips.active, true)))
    .orderBy(asc(payslips.year), asc(payslips.period), asc(payslips.id));
  if (rows.length === 0) return [];
  const lines = await getDb()
    .select({ id: payrollRawLines.id, code: payrollRawLines.code, documentId: payrollRawLines.documentId })
    .from(payrollRawLines)
    .where(
      and(
        userScoped(ctx).owns(payrollRawLines),
        inArray(
          payrollRawLines.documentId,
          rows.map((row) => row.documentId),
        ),
      ),
    )
    .orderBy(asc(payrollRawLines.documentId), asc(payrollRawLines.position));
  const byDocument = new Map<string, string[]>();
  for (const line of lines) {
    if (!FUND_ROLES.includes(codeMap.get(line.code) ?? "other")) continue;
    byDocument.set(line.documentId, [...(byDocument.get(line.documentId) ?? []), line.id]);
  }
  return rows.flatMap((row) => pensionCompetenceOf(row, byDocument.get(row.documentId) ?? []) ?? []);
}
