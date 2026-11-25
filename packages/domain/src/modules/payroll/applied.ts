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
import { type Pairs, pairsOf } from "./service/fields";
import { kindOf } from "./rules";

type Line = { id: string; code: string };

/** The amounts for a fund come from the payslip's pairs: the fixed columns are no longer read (R5f.1). */
function eventOf(
  payslip: Payslip,
  pairs: Pairs,
  lines: readonly Line[],
  codeMap: ReadonlyMap<string, CodeRole>,
): PayslipApplied {
  const pair = (key: string) => pairs[key] ?? null;
  return {
    payslipId: payslip.id,
    year: payslip.year,
    period: payslip.period,
    ...kindOf(payslip),
    printedOn: payslip.printedOn,
    workerCents: pair("employeeFundEffective"),
    employerCents: pair("employerFundPrinted"),
    tfrCents: pair("tfrContributionLine"),
    workerEnrollmentCents: pair("employeeFundEnrollment"),
    employerEnrollmentCents: pair("employerFundEnrollment"),
    workerAdjustmentCents: pair("employeeFundAdjustments"),
    employerAdjustmentCents: pair("employerFundAdjustments"),
    lines: lines.map((line) => ({ id: line.id, role: codeMap.get(line.code) ?? "other" })),
  };
}

/** The event of one payslip just applied, read inside the applying transaction. */
export async function appliedEventOf(ctx: Pick<Ctx, "userId">, payslip: Payslip, executor: Db | Tx): Promise<PayslipApplied> {
  const pairs = (await pairsOf(ctx, [payslip.id], executor)).get(payslip.id) ?? {};
  if (payslip.documentId === null) return eventOf(payslip, pairs, [], new Map());
  const lines = await executor
    .select({ id: payrollRawLines.id, code: payrollRawLines.code })
    .from(payrollRawLines)
    .where(and(eq(payrollRawLines.documentId, payslip.documentId), userScoped(ctx).owns(payrollRawLines)))
    .orderBy(asc(payrollRawLines.position));
  return eventOf(payslip, pairs, lines, await codeMapOf(ctx));
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
  const pairs = await pairsOf(
    ctx,
    rows.map((row) => row.id),
  );
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
  return rows.map((row) =>
    eventOf(row, pairs.get(row.id) ?? {}, (row.documentId && byDocument.get(row.documentId)) || [], codeMap),
  );
}
