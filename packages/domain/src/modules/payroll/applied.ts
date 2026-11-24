// What an applied payslip hands its listeners (audit PAY-5): the event `PayslipApplied`, from the
// payslip's fields as they stand — corrections included — and its body lines with their roles.
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Ctx } from "../../platform/context";
import { type Db, getDb, type Tx } from "../../platform/db/client";
import { userScoped } from "../../platform/db/scope";
import type { PayslipApplied } from "./events";
import type { CodeRole } from "./rules";
import { payrollRawLines, payslips } from "./schema";
import { codeMapOf, type Payslip } from "./service/codes";

type Line = { id: string; code: string };

function eventOf(payslip: Payslip, lines: readonly Line[], codeMap: ReadonlyMap<string, CodeRole>): PayslipApplied {
  return {
    payslipId: payslip.id,
    year: payslip.year,
    period: payslip.period,
    type: payslip.type,
    printedOn: payslip.printedOn,
    workerCents: payslip.employeeFundEffective,
    employerCents: payslip.employerFundPrinted,
    tfrCents: payslip.tfrContributionLine,
    workerEnrollmentCents: payslip.employeeFundEnrollment,
    employerEnrollmentCents: payslip.employerFundEnrollment,
    workerAdjustmentCents: payslip.employeeFundAdjustments,
    employerAdjustmentCents: payslip.employerFundAdjustments,
    lines: lines.map((line) => ({ id: line.id, role: codeMap.get(line.code) ?? "other" })),
  };
}

/** The event of one payslip just applied, read inside the applying transaction. */
export async function appliedEventOf(ctx: Pick<Ctx, "userId">, payslip: Payslip, executor: Db | Tx): Promise<PayslipApplied> {
  if (payslip.documentId === null) return eventOf(payslip, [], new Map());
  const lines = await executor
    .select({ id: payrollRawLines.id, code: payrollRawLines.code })
    .from(payrollRawLines)
    .where(and(eq(payrollRawLines.documentId, payslip.documentId), userScoped(ctx).owns(payrollRawLines)))
    .orderBy(asc(payrollRawLines.position));
  return eventOf(payslip, lines, await codeMapOf(ctx));
}

/**
 * The event of every applied payslip, oldest first: what a pension fund publishes from scratch, at
 * its creation and from its Settings («Rebuild from payslips»).
 */
export async function appliedPayslips(ctx: Pick<Ctx, "userId">): Promise<PayslipApplied[]> {
  const rows = await getDb()
    .select()
    .from(payslips)
    .where(and(userScoped(ctx).owns(payslips), eq(payslips.active, true)))
    .orderBy(asc(payslips.year), asc(payslips.period), asc(payslips.id));
  if (rows.length === 0) return [];
  const codeMap = await codeMapOf(ctx);
  const lines = await getDb()
    .select({ id: payrollRawLines.id, code: payrollRawLines.code, documentId: payrollRawLines.documentId })
    .from(payrollRawLines)
    .where(
      and(
        userScoped(ctx).owns(payrollRawLines),
        inArray(
          payrollRawLines.documentId,
          rows.flatMap((row) => row.documentId ?? []),
        ),
      ),
    )
    .orderBy(asc(payrollRawLines.documentId), asc(payrollRawLines.position));
  const byDocument = new Map<string, Line[]>();
  for (const line of lines) byDocument.set(line.documentId, [...(byDocument.get(line.documentId) ?? []), line]);
  return rows.map((row) => eventOf(row, (row.documentId && byDocument.get(row.documentId)) || [], codeMap));
}
