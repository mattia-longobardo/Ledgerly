import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { saveImportBalance } from "@/modules/accounts/service";
import { readPdfText } from "@/modules/imports/pdf/text";
import type { DocumentKind } from "@/modules/imports/rules";
import {
  claimForExtraction,
  type Document,
  decideEvidence,
  type EvidenceInput,
  failExtraction,
  getDocument,
  ImportError,
  listEvidence,
  readOriginal,
  requireDocument,
  transition,
  uploadDocument,
  writeEvidence,
} from "@/modules/imports/service";
import type { Ctx } from "@/platform/context";
import { type CivilDate, isCivilDate } from "@/platform/dates";
import { type Db, getDb, type Tx } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import { type Cents, centsToDecimal, parseCents } from "@/platform/money";
import {
  OperationsParseError,
  OPERATIONS_PARSER_VERSION,
  type ParsedOperation,
} from "../parse/cometa-operations";
import { parseCometaPosition, POSITION_FIELDS, POSITION_PARSER_VERSION } from "../parse/cometa-position";
import { parseCometaOperations } from "../parse/export";
import type { ValuationRow } from "../queries";
import { fundOperations, fundValuations, positionSnapshots, unitMovements } from "../schema";
import { FundError } from "../service";
import { requirePensionFund } from "./service";

export type Operation = typeof fundOperations.$inferSelect;
export type UnitMovement = typeof unitMovements.$inferSelect;
export type PositionSnapshot = typeof positionSnapshots.$inferSelect;
type Executor = Db | Tx;

/** Steps 1–2 of the pipeline for a Cometa document (spec §9.3); the caller reads it right after. */
export async function uploadCometaDocument(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  kind: Extract<DocumentKind, "cometa_operations" | "cometa_position">,
  file: { name: string; bytes: Uint8Array },
): Promise<{ document: Document; duplicate: boolean }> {
  return uploadDocument(ctx, { kind, fileName: file.name, bytes: file.bytes });
}

const evidenceOf = (
  field: string,
  value: string | null,
  label: string,
  raw: string,
  unit: EvidenceInput["unit"] = "text",
): EvidenceInput => ({
  field,
  value,
  unit,
  sourceLabel: label,
  page: null,
  bbox: null,
  origin: "printed",
  confidence: 0.99,
  rawText: raw,
});

/** What an export's operation leaves as evidence (GC §10): its cells, row by row. */
export function operationEvidence(operation: ParsedOperation, index: number): EvidenceInput[] {
  const at = `op${index + 1}`;
  const row = `Riga ${operation.rows.join(", ")}`;
  const money = (name: string, label: string, cents: Cents) =>
    evidenceOf(`${at}.${name}`, centsToDecimal(cents), `${row} · ${label}`, centsToDecimal(cents), "eur");
  return [
    evidenceOf(`${at}.type`, operation.originalType, `${row} · Tipo Operazione`, operation.originalType),
    evidenceOf(
      `${at}.state`,
      operation.originalState,
      `${row} · Stato Operazione`,
      operation.originalState ?? "",
    ),
    evidenceOf(
      `${at}.date`,
      operation.operationDate,
      `${row} · Data Operazione`,
      operation.operationDate,
      "date",
    ),
    evidenceOf(
      `${at}.competence`,
      operation.competenceText,
      `${row} · Trimestre Comp.`,
      operation.competenceText ?? "",
    ),
    money("worker", "Importo Lordo Aderente", operation.workerCents),
    money("employer", "Importo Lordo Azienda", operation.employerCents),
    money("tfr", "Tfr", operation.tfrCents),
    money("other", "Altro", operation.otherCents),
    money("fees", "Quota Spese", operation.feesCents),
    money("net", "Importo Netto Spese", operation.netCents),
    ...operation.movements.flatMap((movement, position) => [
      evidenceOf(
        `${at}.m${position + 1}.compartment`,
        movement.compartment,
        `Riga ${movement.row} · Comparto`,
        movement.compartment,
      ),
      evidenceOf(
        `${at}.m${position + 1}.units`,
        movement.units,
        `Riga ${movement.row} · Numero Quote`,
        movement.units,
      ),
      evidenceOf(
        `${at}.m${position + 1}.price`,
        movement.unitPrice,
        `Riga ${movement.row} · Valore Quota`,
        movement.unitPrice ?? "",
      ),
      evidenceOf(
        `${at}.m${position + 1}.priceDate`,
        movement.unitPriceDate,
        `Riga ${movement.row} · Data Valore Quota`,
        movement.unitPriceDate ?? "",
        "date",
      ),
    ]),
  ];
}

/**
 * Step 3 for a Cometa document (spec §9.3): claims it, reads the original outside any transaction,
 * parses it and writes the evidence, then waits for review. A file that cannot be read fails with a
 * code, never with the document's own text (spec §5.4).
 */
export async function processCometaDocument(
  ctx: Pick<Ctx, "userId">,
  documentId: string,
  options: { stuckBefore?: Date } = {},
): Promise<Document | null> {
  const claimed = await claimForExtraction(ctx, documentId, options);
  if (!claimed || (claimed.kind !== "cometa_operations" && claimed.kind !== "cometa_position")) return null;
  try {
    const original = await readOriginal(ctx, documentId);
    if (!original) {
      await failExtraction(ctx, documentId, "original_missing");
      return getDocument(ctx, documentId);
    }
    let rows: EvidenceInput[];
    let version: string;
    if (claimed.kind === "cometa_operations") {
      version = OPERATIONS_PARSER_VERSION;
      try {
        rows = parseCometaOperations(original.bytes).operations.flatMap(operationEvidence);
      } catch (error) {
        await failExtraction(
          ctx,
          documentId,
          error instanceof OperationsParseError ? error.code : "parse_failed",
        );
        return getDocument(ctx, documentId);
      }
    } else {
      version = POSITION_PARSER_VERSION;
      try {
        rows = parseCometaPosition(await readPdfText(original.bytes)).fields;
      } catch {
        await failExtraction(ctx, documentId, "unreadable_pdf");
        return getDocument(ctx, documentId);
      }
    }
    return await getDb().transaction(async (tx) => {
      await writeEvidence(ctx, documentId, rows, tx);
      return transition(
        ctx,
        documentId,
        "needs_review",
        { parserVersion: version, extractedAt: new Date(), error: null },
        tx,
      );
    });
  } catch {
    await failExtraction(ctx, documentId, "extraction_failed");
    return getDocument(ctx, documentId);
  }
}

async function requireCometaDocument(
  ctx: Pick<Ctx, "userId">,
  documentId: string,
  kind: DocumentKind,
): Promise<Document> {
  try {
    const document = await requireDocument(ctx, documentId);
    if (document.kind !== kind) throw new FundError("not_found");
    return document;
  } catch (error) {
    if (error instanceof ImportError) throw new FundError("not_found");
    throw error;
  }
}

/** The operations already stored for a fund, by the key that recognises them across exports. */
async function keysOf(ctx: Pick<Ctx, "userId">, fundId: string, executor: Executor = getDb()) {
  const rows = await executor
    .select({ id: fundOperations.id, originKey: fundOperations.originKey })
    .from(fundOperations)
    .where(and(eq(fundOperations.fundId, fundId), userScoped(ctx).owns(fundOperations)));
  return new Map(rows.map((row) => [row.originKey, row.id]));
}

export type PreviewState = "new" | "known" | "changed";

export interface OperationPreview {
  operation: ParsedOperation;
  state: PreviewState;
}

/**
 * The review of an export before it is applied (plan F6 §3.6.10): every operation as read, and
 * whether the fund already knows it — the same file twice changes nothing (spec §9.3 dedup by
 * SHA-256), and an export overlapping another recognises its operations by their key.
 */
export async function previewOperations(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  documentId: string,
): Promise<{ document: Document; rows: OperationPreview[] }> {
  const document = await requireCometaDocument(ctx, documentId, "cometa_operations");
  await requirePensionFund(ctx, fundId);
  const original = await readOriginal(ctx, documentId);
  if (!original) throw new FundError("not_found");
  const parsed = parseCometaOperations(original.bytes);
  const stored = await getDb()
    .select()
    .from(fundOperations)
    .where(and(eq(fundOperations.fundId, fundId), userScoped(ctx).owns(fundOperations)));
  const byKey = new Map(stored.map((row) => [row.originKey, row]));
  return {
    document,
    rows: parsed.operations.map((operation) => {
      const before = byKey.get(operation.originKey);
      if (!before) return { operation, state: "new" as const };
      const same =
        before.originalState === operation.originalState &&
        before.classification === operation.classification &&
        before.netCents === operation.netCents;
      return { operation, state: same ? ("known" as const) : ("changed" as const) };
    }),
  };
}

/**
 * Step 5 for an export (spec §9.3; GC §11.6): the operations of the document, applied to the fund.
 * An operation the fund already knows is updated — a later export adds its state and its units —,
 * never added twice; one it does not know is created with its unit movements. The document is
 * read again here, so what is applied is what the file says.
 */
export async function applyOperations(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  documentId: string,
): Promise<{ created: number; updated: number }> {
  const fund = await requirePensionFund(ctx, fundId);
  const document = await requireCometaDocument(ctx, documentId, "cometa_operations");
  if (document.state !== "needs_review" && document.state !== "verified") throw new FundError("invalid");
  const original = await readOriginal(ctx, documentId);
  if (!original) throw new FundError("not_found");
  const parsed = parseCometaOperations(original.bytes);
  return getDb().transaction(async (tx) => {
    const known = await keysOf(ctx, fund.id, tx);
    let created = 0;
    let updated = 0;
    for (const operation of parsed.operations) {
      const values = {
        documentId,
        originalType: operation.originalType,
        classification: operation.classification,
        originalState: operation.originalState,
        competenceYear: operation.competenceYear,
        competenceQuarter: operation.competenceQuarter,
        operationDate: operation.operationDate,
        workerCents: operation.workerCents,
        employerCents: operation.employerCents,
        tfrCents: operation.tfrCents,
        otherCents: operation.otherCents,
        feesCents: operation.feesCents,
        netCents: operation.netCents,
        employerTaxCode: operation.employerTaxCode,
        employerName: operation.employerName,
        source: "import" as const,
      };
      const existing = known.get(operation.originKey);
      let id: string;
      if (existing) {
        await tx
          .update(fundOperations)
          .set(values)
          .where(and(eq(fundOperations.id, existing), userScoped(ctx).owns(fundOperations)));
        id = existing;
        updated += 1;
      } else {
        const [row] = await tx
          .insert(fundOperations)
          .values(userScoped(ctx).stamp({ fundId: fund.id, originKey: operation.originKey, ...values }))
          .returning({ id: fundOperations.id });
        id = row.id;
        created += 1;
      }
      await tx
        .delete(unitMovements)
        .where(and(eq(unitMovements.operationId, id), userScoped(ctx).owns(unitMovements)));
      if (operation.movements.length > 0) {
        await tx.insert(unitMovements).values(
          operation.movements.map((movement, position) =>
            userScoped(ctx).stamp({
              operationId: id,
              position: position + 1,
              compartment: movement.compartment,
              units: movement.units,
              unitPrice: movement.unitPrice,
              unitPriceDate: movement.unitPriceDate,
            }),
          ),
        );
      }
    }
    if (document.state === "needs_review" && !(await transition(ctx, documentId, "verified", {}, tx))) {
      throw new FundError("invalid");
    }
    if (!(await transition(ctx, documentId, "applied", {}, tx))) throw new FundError("invalid");
    return { created, updated };
  });
}

/** A value read from a position document as it stands: the person's correction, else as printed. */
export async function positionValues(
  ctx: Pick<Ctx, "userId">,
  documentId: string,
  executor: Executor = getDb(),
): Promise<Map<string, string | null>> {
  const rows = await listEvidence(ctx, documentId, executor);
  return new Map(
    rows.map((row) => [row.field, row.verification === "corrected" ? row.correctedValue : row.value]),
  );
}

/** Confirms or corrects one value of a position document (spec §9.3 step 4). */
export async function decidePositionField(
  ctx: Pick<Ctx, "userId">,
  documentId: string,
  field: string,
  correctedValue: string | null,
): Promise<void> {
  const document = await requireCometaDocument(ctx, documentId, "cometa_position");
  if (document.state !== "needs_review" && document.state !== "verified") throw new FundError("invalid");
  if (!(POSITION_FIELDS as readonly string[]).includes(field)) throw new FundError("invalid");
  let value = correctedValue === null ? null : correctedValue.trim();
  if (value !== null) {
    if (field === "valuationDate") {
      if (!isCivilDate(value)) throw new FundError("invalid");
    } else {
      if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(value)) throw new FundError("invalid");
      value = centsToDecimal(parseCents(value));
    }
  }
  await getDb().transaction(async (tx) => {
    const decided = await decideEvidence(ctx, documentId, field, value, tx);
    if (!decided) throw new FundError("not_found");
    if (value !== null && decided.value === value) await decideEvidence(ctx, documentId, field, null, tx);
    if (document.state === "verified") await transition(ctx, documentId, "needs_review", {}, tx);
  });
}

const amount = (values: Map<string, string | null>, field: string): Cents | null => {
  const value = values.get(field);
  return value === null || value === undefined || !/^-?\d+(\.\d{1,2})?$/.test(value)
    ? null
    : parseCents(value);
};

/**
 * Step 5 for a position summary (GC §8.5): the statement becomes a snapshot and the `import`
 * balance of the valuation account on its valuation date — the value has one source, as in F4. A
 * statement for a date already known replaces the one there.
 */
export async function applyPosition(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  documentId: string,
): Promise<PositionSnapshot> {
  const fund = await requirePensionFund(ctx, fundId);
  const document = await requireCometaDocument(ctx, documentId, "cometa_position");
  if (document.state !== "needs_review" && document.state !== "verified") throw new FundError("invalid");
  const values = await positionValues(ctx, documentId);
  const on = values.get("valuationDate");
  const valueCents = amount(values, "value");
  if (!on || !isCivilDate(on) || valueCents === null) throw new FundError("invalid");
  return getDb().transaction(async (tx) => {
    const entry = await saveImportBalance(
      ctx,
      fund.valuationAccountId,
      { on, cents: valueCents, note: document.fileName.slice(0, 200) },
      tx,
    );
    const row = {
      documentId,
      balanceEntryId: entry.id,
      valuationDate: on,
      valueCents,
      tfrCents: amount(values, "tfr"),
      workerCents: amount(values, "worker"),
      employerCents: amount(values, "employer"),
      transfersInCents: amount(values, "transfersIn"),
      inflowsCents: amount(values, "inflows"),
      advancesCents: amount(values, "advances"),
      redemptionsCents: amount(values, "redemptions"),
      ritaCents: amount(values, "rita"),
      outflowsCents: amount(values, "outflows"),
      reportedGainCents: amount(values, "reportedGain"),
    };
    const [snapshot] = await tx
      .insert(positionSnapshots)
      .values(userScoped(ctx).stamp({ fundId: fund.id, ...row }))
      .onConflictDoUpdate({ target: [positionSnapshots.fundId, positionSnapshots.valuationDate], set: row })
      .returning();
    if (document.state === "needs_review" && !(await transition(ctx, documentId, "verified", {}, tx))) {
      throw new FundError("invalid");
    }
    if (!(await transition(ctx, documentId, "applied", {}, tx))) throw new FundError("invalid");
    return snapshot;
  });
}

/** A fund's operations, oldest first, with their unit movements. */
export async function operationsOf(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  executor: Executor = getDb(),
): Promise<{ operations: Operation[]; movements: UnitMovement[] }> {
  const operations = await executor
    .select()
    .from(fundOperations)
    .where(and(eq(fundOperations.fundId, fundId), userScoped(ctx).owns(fundOperations)))
    .orderBy(asc(fundOperations.operationDate), asc(fundOperations.id));
  if (operations.length === 0) return { operations, movements: [] };
  const movements = await executor
    .select()
    .from(unitMovements)
    .where(
      and(
        userScoped(ctx).owns(unitMovements),
        inArray(
          unitMovements.operationId,
          operations.map((operation) => operation.id),
        ),
      ),
    )
    .orderBy(asc(unitMovements.operationId), asc(unitMovements.position));
  return { operations, movements };
}

/**
 * The valuations recorded by hand on a pension fund, newest first, each with what had gone in by
 * its day. They are this fund's only value points when nothing of Cometa's is imported — which is
 * the ordinary case — so the Valuations tab has to show them, and let them be corrected
 * (owner, 2026-09-20).
 */
export async function recordedValuationsOf(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  entries: readonly { id: string; on: CivilDate; balanceCents: Cents }[],
  paidInBy: (on: CivilDate) => Cents,
  executor: Executor = getDb(),
): Promise<ValuationRow[]> {
  const rows = await executor
    .select()
    .from(fundValuations)
    .where(and(eq(fundValuations.fundId, fundId), userScoped(ctx).owns(fundValuations)));
  const byEntry = new Map(rows.map((row) => [row.balanceEntryId, row]));
  return entries
    .filter((entry) => byEntry.has(entry.id))
    .map((entry) => {
      const valuation = byEntry.get(entry.id)!;
      return {
        id: valuation.id,
        balanceEntryId: entry.id,
        on: entry.on,
        valueCents: entry.balanceCents,
        units: valuation.units,
        note: valuation.note,
        paidInCents: paidInBy(entry.on),
      };
    });
}

/** A fund's statements, newest first. */
export async function snapshotsOf(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  executor: Executor = getDb(),
): Promise<PositionSnapshot[]> {
  return executor
    .select()
    .from(positionSnapshots)
    .where(and(eq(positionSnapshots.fundId, fundId), userScoped(ctx).owns(positionSnapshots)))
    .orderBy(desc(positionSnapshots.valuationDate), desc(positionSnapshots.id));
}
