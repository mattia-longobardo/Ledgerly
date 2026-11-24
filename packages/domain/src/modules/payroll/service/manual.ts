// A payslip typed by hand (rewrite plan R5g, decision ST-21): how a person whose payslips no profile
// reads uses Payroll. Month — or the number of the extra payment —, gross, taxes, contributions and
// net, the country's fields if they want, and the PDF if they have it. It enters the register and
// the KPIs at once: there is nothing to review.
import { and, eq, ne, sql } from "drizzle-orm";
import { deleteDocument, getDocument, transition } from "../../imports/service";
import type { Ctx } from "../../../platform/context";
import { type Db, getDb, type Tx } from "../../../platform/db/client";
import { hasPgError, UNIQUE_VIOLATION } from "../../../platform/db/errors";
import { userScoped } from "../../../platform/db/scope";
import { appliedEventOf } from "../applied";
import { MONEY_FIELDS, type MoneyField } from "../fields";
import { payslipApplied, payslipWithdrawn } from "../events";
import { baseColumnsOf, type ManualPayslip, manualPayslipSchema, type PayslipType, periodOfManual, typeOfKind } from "../rules";
import { payslips } from "../schema";
import { PayrollError, type Payslip } from "./codes";
import { type Pairs, pairsOf, writePairs } from "./fields";

/** A manual payslip as the API reads it: the row, its pairs and its document's name. */
interface ManualView {
  payslip: Payslip;
  fields: Pairs;
  document: { id: string; fileName: string; hasOriginal: boolean } | null;
}

function parse(input: unknown): ManualPayslip {
  const parsed = manualPayslipSchema.safeParse(input);
  if (!parsed.success) throw new PayrollError("invalid_value");
  return parsed.data;
}

/**
 * The applied payslip of the same year, type and month, whoever's key it has: a month is paid once,
 * by hand or read. `except`: the payslip being changed.
 */
export async function activeOfMonth(
  ctx: Pick<Ctx, "userId">,
  key: { year: number; type: PayslipType; period: string | null },
  executor: Db | Tx,
  except?: string,
): Promise<Payslip | null> {
  const [row] = await executor
    .select()
    .from(payslips)
    .where(
      and(
        userScoped(ctx).owns(payslips),
        eq(payslips.active, true),
        eq(payslips.year, key.year),
        eq(payslips.type, key.type),
        key.period === null ? sql`${payslips.period} is null` : eq(payslips.period, key.period),
        except === undefined ? undefined : ne(payslips.id, except),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** A document a manual payslip can take: a payslip's, read, with no payslip of its own. */
async function attachable(ctx: Pick<Ctx, "userId">, documentId: string, transaction: Tx): Promise<void> {
  const document = await getDocument(ctx, documentId);
  if (!document || document.kind !== "payslip") throw new PayrollError("not_found");
  const [taken] = await transaction
    .select({ id: payslips.id })
    .from(payslips)
    .where(and(eq(payslips.documentId, documentId), userScoped(ctx).owns(payslips)));
  if (taken) throw new PayrollError("conflict");
  // Read and not recognised: the review is where it waits. Being read, or waiting for OCR, it cannot.
  if (!(await transition(ctx, documentId, "verified", {}, transaction))) throw new PayrollError("invalid_state");
  if (!(await transition(ctx, documentId, "applied", {}, transaction))) throw new PayrollError("invalid_state");
}

/** The fields of a pack as the fixed columns they are too, until R5f. */
function legacyColumns(fields: Readonly<Record<string, bigint>>): Partial<Record<MoneyField, bigint>> {
  return Object.fromEntries(MONEY_FIELDS.flatMap((field) => (field in fields ? [[field, fields[field]]] : [])));
}

function rowOf(input: ManualPayslip) {
  const type = typeOfKind(input.kind, input.extraNumber);
  return {
    employerKey: "",
    employeeKey: "",
    year: input.year,
    period: periodOfManual(input),
    type,
    kind: input.kind,
    extraNumber: input.extraNumber,
    source: "manual" as const,
    paidOn: input.paidOn,
    ...baseColumnsOf(input),
    // The fixed columns stay written beside the pairs until R5f: every field of a pack is one.
    ...legacyColumns(input.fields),
  };
}

async function writing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    // Another write took the month between the check and the insert: retrying shows `month_applied`.
    if (hasPgError(error, UNIQUE_VIOLATION, "payslips_active_key_uq")) throw new PayrollError("conflict");
    throw error;
  }
}

/** Types a payslip by hand: it is applied at once, and `PayslipApplied` tells the listeners. */
export async function createManualPayslip(ctx: Pick<Ctx, "userId">, input: unknown, now = new Date()): Promise<Payslip> {
  const parsed = parse(input);
  const row = rowOf(parsed);
  return writing(() =>
    getDb().transaction(async (transaction) => {
      if (await activeOfMonth(ctx, row, transaction)) throw new PayrollError("month_applied");
      if (parsed.documentId) await attachable(ctx, parsed.documentId, transaction);
      const [payslip] = await transaction
        .insert(payslips)
        .values(userScoped(ctx).stamp({ ...row, documentId: parsed.documentId, active: true, appliedAt: now }))
        .returning();
      await writePairs(ctx, payslip.id, parsed.fields, transaction);
      await payslipApplied(ctx, await appliedEventOf(ctx, payslip, transaction), transaction);
      return payslip;
    }),
  );
}

async function requireManual(ctx: Pick<Ctx, "userId">, id: string, executor: Db | Tx = getDb()): Promise<Payslip> {
  const [payslip] = await executor
    .select()
    .from(payslips)
    .where(and(eq(payslips.id, id), userScoped(ctx).owns(payslips), eq(payslips.source, "manual")));
  if (!payslip) throw new PayrollError("not_found");
  return payslip;
}

/**
 * Changes a manual payslip. Its document stays: one without a document may take one; another one
 * is refused (delete it and type it again).
 */
export async function updateManualPayslip(ctx: Pick<Ctx, "userId">, id: string, input: unknown): Promise<Payslip> {
  const parsed = parse(input);
  const row = rowOf(parsed);
  return writing(() =>
    getDb().transaction(async (transaction) => {
      const current = await requireManual(ctx, id, transaction);
      if (await activeOfMonth(ctx, row, transaction, id)) throw new PayrollError("month_applied");
      if (parsed.documentId !== current.documentId) {
        if (current.documentId !== null || parsed.documentId === null) throw new PayrollError("invalid_value");
        await attachable(ctx, parsed.documentId, transaction);
      }
      await payslipWithdrawn(ctx, id, transaction);
      // Every pair's column back to null first: a field the person removed is no longer written.
      const cleared = Object.fromEntries(MONEY_FIELDS.map((field) => [field, null]));
      const [payslip] = await transaction
        .update(payslips)
        .set({ ...cleared, ...row, documentId: parsed.documentId })
        .where(and(eq(payslips.id, id), userScoped(ctx).owns(payslips)))
        .returning();
      await writePairs(ctx, id, parsed.fields, transaction);
      await payslipApplied(ctx, await appliedEventOf(ctx, payslip, transaction), transaction);
      return payslip;
    }),
  );
}

/** Deletes a manual payslip, with its document and original when it has one. */
export async function deleteManualPayslip(ctx: Pick<Ctx, "userId">, id: string): Promise<{ deletedDocument: boolean }> {
  const documentId = await getDb().transaction(async (transaction) => {
    const payslip = await requireManual(ctx, id, transaction);
    await payslipWithdrawn(ctx, id, transaction);
    await transaction.delete(payslips).where(and(eq(payslips.id, id), userScoped(ctx).owns(payslips)));
    // An applied document is never deleted: it goes back to review first, as a reopened one does.
    if (payslip.documentId) await transition(ctx, payslip.documentId, "needs_review", {}, transaction);
    return payslip.documentId;
  });
  // The original is removed from storage outside the transaction (no network I/O inside one).
  if (documentId) await deleteDocument(ctx, documentId);
  return { deletedDocument: documentId !== null };
}

/** One manual payslip with its pairs and document; null when it is not a manual one of the person. */
export async function manualPayslipView(ctx: Pick<Ctx, "userId">, id: string): Promise<ManualView | null> {
  let payslip;
  try {
    payslip = await requireManual(ctx, id);
  } catch (error) {
    if (error instanceof PayrollError) return null;
    throw error;
  }
  const [pairs, document] = await Promise.all([
    pairsOf(ctx, [id]),
    payslip.documentId ? getDocument(ctx, payslip.documentId) : null,
  ]);
  return {
    payslip,
    fields: pairs.get(id) ?? {},
    document: document
      ? { id: document.id, fileName: document.fileName, hasOriginal: document.storageKey !== null }
      : null,
  };
}

/** The manual payslip of a document, if it has one: the review's writes leave it alone. */
export async function manualOfDocument(ctx: Pick<Ctx, "userId">, documentId: string): Promise<Payslip | null> {
  const [payslip] = await getDb()
    .select()
    .from(payslips)
    .where(and(eq(payslips.documentId, documentId), userScoped(ctx).owns(payslips), eq(payslips.source, "manual")));
  return payslip ?? null;
}
