import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { decideEvidence, deleteDocument, type Document, ImportError, listEvidence, renameDocument, requireDocument, transition } from "../../imports/service";
import type { Ctx } from "../../../platform/context";
import { addMonths, isCivilDate } from "../../../shared/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { hasPgError, UNIQUE_VIOLATION } from "../../../platform/db/errors";
import { userScoped } from "../../../platform/db/scope";
import { centsToDecimal, parseCents } from "../../../shared/money";
import { FIELDS, type FieldName, isDerived, isFieldName, LEAVE_COLUMNS, LEAVE_KINDS, leaveField } from "../fields";
import { hasBlockingFailure } from "../parse/checks";
import { usagePeriodOf } from "../rules";
import { appliedEventOf } from "../applied";
import { payslipApplied, payslipWithdrawn } from "../events";
import { leaveBalanceSnapshots, payrollLeaveEvents, payslips } from "../schema";
import { PayrollError, type Payslip } from "./codes";
import { activeOfMonth, deleteManualPayslip, manualOfDocument } from "./manual";
import { activeWithKey, computeState, linesOf, processPayslip, recompute, type Recomputed } from "./reading";

// ——— Review (spec §7.8, §9.3 step 4) ———

/** A typed value in its canonical form, or an error: amounts and hours to two decimals. */
function canonicalValue(field: FieldName, value: string): string {
  const unit = FIELDS[field].unit;
  const text = value.trim();
  if (unit === "eur" || unit === "hours") {
    if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(text)) throw new PayrollError("invalid_value");
    return centsToDecimal(parseCents(text));
  }
  if (unit === "date") {
    if (!isCivilDate(text)) throw new PayrollError("invalid_value");
    return text;
  }
  if (text.length === 0 || text.length > 100) throw new PayrollError("invalid_value");
  return text;
}

const REVIEWABLE = ["needs_review", "verified"] as const;

/**
 * Confirms a value as read, or corrects it; the original stays beside the correction (owner's spec
 * L249). Derived values follow from the others and are never set by hand. A verified payslip that
 * changes goes back to review.
 */
export async function decideField(
  ctx: Pick<Ctx, "userId">,
  documentId: string,
  field: string,
  correctedValue: string | null,
): Promise<Recomputed> {
  if (!isFieldName(field)) throw new PayrollError("invalid_value");
  if (isDerived(field)) throw new PayrollError("derived_field");
  const document = await requireDocumentOf(ctx, documentId);
  if (!(REVIEWABLE as readonly string[]).includes(document.state)) throw new PayrollError("invalid_state");
  const value = correctedValue === null ? null : canonicalValue(field, correctedValue);
  return getDb().transaction(async (tx) => {
    const decided = await decideEvidence(ctx, documentId, field, value, tx);
    if (!decided) throw new PayrollError("not_found");
    // A correction equal to what was read is a confirmation.
    if (value !== null && decided.value === value) await decideEvidence(ctx, documentId, field, null, tx);
    const result = await recompute(ctx, documentId, tx);
    if (document.state === "verified") await transition(ctx, documentId, "needs_review", {}, tx);
    return result;
  });
}

async function requireDocumentOf(ctx: Pick<Ctx, "userId">, documentId: string): Promise<Document> {
  try {
    const document = await requireDocument(ctx, documentId);
    if (document.kind !== "payslip") throw new PayrollError("not_found");
    return document;
  } catch (error) {
    if (error instanceof ImportError) throw new PayrollError("not_found");
    throw error;
  }
}

/**
 * A person vouches for the payslip (spec §7.8): every value the LLM inferred must have been
 * confirmed or corrected first, and failed checks must be acknowledged — never waved through.
 */
export async function verifyPayslip(
  ctx: Pick<Ctx, "userId">,
  documentId: string,
  options: { acknowledgeFailures?: boolean } = {},
): Promise<void> {
  const document = await requireDocumentOf(ctx, documentId);
  if (document.state !== "needs_review") throw new PayrollError("invalid_state");
  await getDb().transaction(async (tx) => {
    const evidence = await listEvidence(ctx, documentId, tx);
    if (evidence.some((row) => row.origin === "inferred" && row.verification === "unverified")) {
      throw new PayrollError("unconfirmed_inferred");
    }
    const { payslip, assembled } = await recompute(ctx, documentId, tx);
    if (!payslip) throw new PayrollError("no_identity");
    if (hasBlockingFailure(assembled.checks) && !options.acknowledgeFailures) {
      throw new PayrollError("blocking_checks");
    }
    if (!(await transition(ctx, documentId, "verified", {}, tx))) throw new PayrollError("invalid_state");
  });
}

/**
 * Step 5 (spec §7.8 "Applicazione"), one transaction: the active payslip with the same logical key
 * is superseded — never summed —, this one becomes the active one, its leave snapshots and
 * events are written, and `PayslipApplied` tells the listeners (the pension fund) in the same
 * transaction. The payslip after it, if applied, has its leave read again, since its uses of
 * leave are confirmed against this one.
 */
export async function applyPayslip(ctx: Pick<Ctx, "userId">, documentId: string, now: Date = new Date()): Promise<Payslip> {
  const document = await requireDocumentOf(ctx, documentId);
  if (document.state !== "verified") throw new PayrollError("invalid_state");
  try {
    return await getDb().transaction(async (tx) => {
      const { payslip, identity } = await recompute(ctx, documentId, tx);
      if (!payslip || !identity) throw new PayrollError("no_identity");
      // A month typed by hand is not superseded by a reading: the person deletes one of the two.
      if ((await activeOfMonth(ctx, identity, tx, payslip.id))?.source === "manual") throw new PayrollError("conflict");
      const replaced = await activeWithKey(ctx, identity, tx);
      if (replaced && replaced.id !== payslip.id) {
        await tx
          .update(payslips)
          .set({ active: false, supersededBy: payslip.id })
          .where(and(eq(payslips.id, replaced.id), userScoped(ctx).owns(payslips)));
        await clearLeave(ctx, replaced.id, tx);
        await payslipWithdrawn(ctx, replaced.id, tx);
        if (!(await transition(ctx, replaced.documentId!, "superseded", {}, tx))) throw new PayrollError("conflict");
      }
      const [applied] = await tx
        .update(payslips)
        .set({ active: true, appliedAt: now, supersededBy: null })
        .where(and(eq(payslips.id, payslip.id), userScoped(ctx).owns(payslips)))
        .returning();
      await writeLeave(ctx, applied, tx);
      await announce(ctx, applied, tx);
      if (!(await transition(ctx, documentId, "applied", {}, tx))) throw new PayrollError("conflict");
      await rereadNext(ctx, applied, tx);
      return applied;
    });
  } catch (error) {
    if (hasPgError(error, UNIQUE_VIOLATION, "payslips_active_key_uq")) throw new PayrollError("conflict");
    throw error;
  }
}

/** `PayslipApplied` (spec §7.8): the listeners hear what an applied payslip carries. */
async function announce(ctx: Pick<Ctx, "userId">, payslip: Payslip, tx: Tx): Promise<void> {
  await payslipApplied(ctx, await appliedEventOf(ctx, payslip, tx), tx);
}

/** The next month's payslip, if applied, confirms its uses of leave against this one: read them again. */
async function rereadNext(ctx: Pick<Ctx, "userId">, payslip: Payslip, tx: Tx): Promise<void> {
  if (payslip.type !== "ordinary" || payslip.period === null || payslip.documentId === null) return;
  const [next] = await tx
    .select()
    .from(payslips)
    .where(
      and(
        userScoped(ctx).owns(payslips),
        eq(payslips.active, true),
        eq(payslips.type, "ordinary"),
        eq(payslips.employerKey, payslip.employerKey),
        eq(payslips.employeeKey, payslip.employeeKey),
        eq(payslips.period, addMonths(payslip.period, 1)),
      ),
    );
  if (next?.documentId) {
    await recompute(ctx, next.documentId, tx);
    await writeLeave(ctx, next, tx);
  }
}

/**
 * Takes an applied payslip back to review so its values can be changed — `applyPayslip` undone, in
 * one transaction: it leaves the register with its leave (`PayslipWithdrawn`), the payslip it
 * had replaced (a rectification) is applied again, and the next month's leave is read again.
 * Applying it once more after the review puts everything back. Returns whether a replaced payslip
 * was restored.
 */
export async function reopenPayslip(ctx: Pick<Ctx, "userId">, documentId: string): Promise<{ restored: boolean }> {
  const document = await requireDocumentOf(ctx, documentId);
  if (document.state !== "applied") throw new PayrollError("invalid_state");
  return getDb().transaction(async (tx) => {
    const [payslip] = await tx
      .select()
      .from(payslips)
      .where(and(eq(payslips.documentId, documentId), userScoped(ctx).owns(payslips), eq(payslips.active, true)));
    if (!payslip) throw new PayrollError("conflict");
    // A payslip typed by hand has no review to go back to: it is changed in place.
    if (payslip.source === "manual") throw new PayrollError("invalid_state");
    await clearLeave(ctx, payslip.id, tx);
    await payslipWithdrawn(ctx, payslip.id, tx);
    const [reopened] = await tx
      .update(payslips)
      .set({ active: false, appliedAt: null })
      .where(and(eq(payslips.id, payslip.id), userScoped(ctx).owns(payslips)))
      .returning();
    if (!(await transition(ctx, documentId, "needs_review", {}, tx))) throw new PayrollError("conflict");

    const [replaced] = await tx
      .select()
      .from(payslips)
      .where(and(eq(payslips.supersededBy, payslip.id), userScoped(ctx).owns(payslips)))
      .orderBy(desc(payslips.appliedAt), desc(payslips.id))
      .limit(1);
    if (replaced) {
      const [restored] = await tx
        .update(payslips)
        .set({ active: true, supersededBy: null })
        .where(and(eq(payslips.id, replaced.id), userScoped(ctx).owns(payslips)))
        .returning();
      if (!(await transition(ctx, restored.documentId!, "applied", {}, tx))) throw new PayrollError("conflict");
      await writeLeave(ctx, restored, tx);
      await announce(ctx, restored, tx);
    }
    await rereadNext(ctx, reopened, tx);
    return { restored: replaced !== undefined };
  });
}

/**
 * Deletes a payslip's document with its original. An applied one is reopened first, so it leaves
 * the register as `reopenPayslip` takes it out — its leave and pension with it, the payslip it had
 * replaced applied again — and only then is deleted. Says what it did.
 */
export async function deletePayslip(
  ctx: Pick<Ctx, "userId">,
  documentId: string,
): Promise<{ unapplied: boolean; restored: boolean }> {
  const document = await requireDocumentOf(ctx, documentId);
  const manual = await manualOfDocument(ctx, documentId);
  if (manual) {
    await deleteManualPayslip(ctx, manual.id);
    return { unapplied: true, restored: false };
  }
  const { restored } = document.state === "applied" ? await reopenPayslip(ctx, documentId) : { restored: false };
  await deleteDocument(ctx, documentId);
  return { unapplied: document.state === "applied", restored };
}

/** Renames a payslip's document, whatever its state: the name the register and the review show. */
export async function renamePayslip(ctx: Pick<Ctx, "userId">, documentId: string, name: string): Promise<Document> {
  await requireDocumentOf(ctx, documentId);
  return renameDocument(ctx, documentId, name);
}

async function clearLeave(ctx: Pick<Ctx, "userId">, payslipId: string, tx: Tx): Promise<void> {
  await tx
    .delete(payrollLeaveEvents)
    .where(and(eq(payrollLeaveEvents.payslipId, payslipId), userScoped(ctx).owns(payrollLeaveEvents)));
  await tx
    .delete(leaveBalanceSnapshots)
    .where(and(eq(leaveBalanceSnapshots.payslipId, payslipId), userScoped(ctx).owns(leaveBalanceSnapshots)));
}

/**
 * An applied ordinary payslip's leave (spec §7.8): the balances as printed, snapshots never summed,
 * and the events of its leave lines in the month they were used. A 13th writes none.
 */
async function writeLeave(ctx: Pick<Ctx, "userId">, payslip: Payslip, tx: Tx): Promise<void> {
  await clearLeave(ctx, payslip.id, tx);
  if (payslip.type !== "ordinary" || payslip.period === null || payslip.documentId === null) return;
  const { assembled, profile } = await computeState(ctx, payslip.documentId, tx);
  const values = assembled.values;
  for (const kind of LEAVE_KINDS) {
    const [previousYear, accrued, used, remaining] = LEAVE_COLUMNS.map((column) => values[leaveField(kind, column)] ?? null);
    if ([previousYear, accrued, used, remaining].every((value) => value === null)) continue;
    await tx.insert(leaveBalanceSnapshots).values(
      userScoped(ctx).stamp({
        payslipId: payslip.id,
        kind,
        period: payslip.period,
        previousYear,
        accrued,
        used,
        remaining,
        unitEvidence: profile.unitEvidence,
      }),
    );
  }
  const lines = await linesOf(ctx, payslip.documentId, tx);
  const idOf = new Map(lines.map((line) => [line.position, line.id]));
  for (const event of assembled.events) {
    await tx.insert(payrollLeaveEvents).values(
      userScoped(ctx).stamp({
        payslipId: payslip.id,
        kind: event.kind,
        hours: event.hours,
        payrollPeriod: payslip.period,
        usagePeriod: usagePeriodOf(payslip.period, profile.absenceLagMonths),
        sourceLineIds: event.linePositions.flatMap((position) => idOf.get(position) ?? []),
      }),
    );
  }
}

/** Sets a document aside (spec §7.8 `rejected`); nothing was applied from it, so nothing moves. */
export async function rejectPayslip(ctx: Pick<Ctx, "userId">, documentId: string): Promise<void> {
  await requireDocumentOf(ctx, documentId);
  await getDb().transaction(async (tx) => {
    if (!(await transition(ctx, documentId, "rejected", {}, tx))) throw new PayrollError("invalid_state");
    await tx
      .delete(payslips)
      .where(and(eq(payslips.documentId, documentId), userScoped(ctx).owns(payslips), eq(payslips.active, false)));
  });
}

/** "Retry" (spec §7.8): reads the original again, keeping what a person decided on unchanged values. */
export async function retryPayslip(ctx: Pick<Ctx, "userId">, documentId: string): Promise<Document | null> {
  const document = await requireDocumentOf(ctx, documentId);
  if (["applied", "superseded", "extracting", "received", "scanning"].includes(document.state)) {
    throw new PayrollError("invalid_state");
  }
  return processPayslip(ctx, documentId);
}

/** A person's payslips, for the register (spec §7.8 D13) and the review. */
export async function payslipsOf(ctx: Pick<Ctx, "userId">, documentIds?: readonly string[]): Promise<Payslip[]> {
  return getDb()
    .select()
    .from(payslips)
    .where(
      and(
        userScoped(ctx).owns(payslips),
        documentIds === undefined ? undefined : documentIds.length === 0 ? sql`false` : inArray(payslips.documentId, [...documentIds]),
      ),
    )
    .orderBy(desc(payslips.year), sql`${payslips.period} desc nulls first`, asc(payslips.id));
}
