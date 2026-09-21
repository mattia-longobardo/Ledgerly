// The Cometa documents end to end (plan F6 L2–L4, L6) on the synthetic twins, against the real
// test database and bucket. Every amount here comes from `tests/fixtures/cometa`: all invented.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listBalanceEntries } from "@/modules/accounts/queries";
import { getDocument, listEvidence } from "@/modules/imports/service";
import { applyPayslip, processPayslip, uploadPayslip, verifyPayslip } from "@/modules/payroll/service";
import type { Ctx } from "@/platform/context";
import { deleteFolder, ensureBucket } from "@/platform/storage";
import { closeDatabase, resetDatabase } from "../../../../test/db";
import { newContext } from "../../../../test/fixtures";
import {
  ENROLLMENT,
  EXPORT_AUGUST,
  EXPORT_EXOTIC,
  FIRST_QUARTER,
  POSITION_APRIL,
  POSITION_AUGUST,
  SECOND_QUARTER,
} from "../../../../tests/fixtures/cometa/samples";
import {
  twinOperationsHtml,
  twinOperationsXlsx,
  twinPositionPdf,
  type TwinOperation,
} from "../../../../tests/fixtures/cometa/twin";
import { FEBRUARY, JANUARY, MARCH, THIRTEENTH } from "../../../../tests/fixtures/payroll/samples";
import { twinPdf, type TwinPayslip } from "../../../../tests/fixtures/payroll/twin";
import {
  applyOperations,
  applyPosition,
  decidePositionField,
  operationsOf,
  previewOperations,
  processCometaDocument,
  snapshotsOf,
  uploadCometaDocument,
} from "./imports";
import { pensionDetail } from "./queries";
import {
  addVoluntaryContribution,
  createPensionFund,
  decideDifference,
  deleteManualOperation,
} from "./service";

let ctx: Ctx;
let fundId: string;

beforeAll(ensureBucket);
beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  fundId = (
    await createPensionFund(ctx, {
      name: "Cometa",
      provider: "Cometa",
      compartment: "Crescita",
      startOn: "2031-01-01",
    })
  ).id;
});
afterAll(async () => {
  await deleteFolder("cometa/");
  await deleteFolder("payslips/");
  await closeDatabase();
});

async function importedExport(operations: readonly TwinOperation[], name = "DettaglioOperazioni.xls") {
  const { document, duplicate } = await uploadCometaDocument(ctx, "cometa_operations", {
    name,
    bytes: twinOperationsHtml(operations),
  });
  if (!duplicate) await processCometaDocument(ctx, document.id);
  return { id: document.id, duplicate };
}

async function importedPosition(position = POSITION_AUGUST, name = "riepilogo_posizione.pdf") {
  const { document } = await uploadCometaDocument(ctx, "cometa_position", {
    name,
    bytes: await twinPositionPdf(position),
  });
  await processCometaDocument(ctx, document.id);
  return document.id;
}

async function appliedPayslip(twin: TwinPayslip) {
  const { document } = await uploadPayslip(ctx, { name: `${twin.period}.pdf`, bytes: await twinPdf(twin) });
  await processPayslip(ctx, document.id);
  await verifyPayslip(ctx, document.id);
  await applyPayslip(ctx, document.id);
}

describe("the operations export (plan F6 L2)", () => {
  it("stores the original under cometa/, reads its cells and waits for review", async () => {
    const { id } = await importedExport(EXPORT_AUGUST);
    const document = await getDocument(ctx, id);
    expect(document).toMatchObject({
      state: "needs_review",
      kind: "cometa_operations",
      parserVersion: "cometa-operations@1",
    });
    expect(document?.storageKey).toMatch(new RegExp(`^cometa/${ctx.userId}/\\d{4}/[0-9a-f]{32}\\.xls$`));
    const evidence = await listEvidence(ctx, id);
    expect(evidence.find((row) => row.field === "op1.worker")).toMatchObject({
      value: "25.00",
      origin: "printed",
      sourceLabel: "Riga 1, 2 · Importo Lordo Aderente",
    });
    expect(evidence.find((row) => row.field === "op1.m2.compartment")?.value).toBe("SICUREZZA");
  });

  it("shows every operation as new before applying, and applies them with their units", async () => {
    const { id } = await importedExport(EXPORT_AUGUST);
    const preview = await previewOperations(ctx, fundId, id);
    expect(preview.rows.map((row) => row.state)).toEqual(["new", "new", "new"]);
    expect(await applyOperations(ctx, fundId, id)).toEqual({ created: 3, updated: 0 });
    expect(await getDocument(ctx, id)).toMatchObject({ state: "applied" });
    const { operations, movements } = await operationsOf(ctx, fundId);
    expect(operations).toHaveLength(3);
    expect(operations[0]).toMatchObject({
      operationDate: "2031-04-18",
      classification: "contribution",
      competenceYear: 2031,
      competenceQuarter: 1,
      workerCents: 7_500n,
      netCents: 65_700n,
      source: "import",
      documentId: id,
    });
    expect(movements.filter((movement) => movement.operationId === operations[2].id)).toHaveLength(2);
  });

  it("makes the same file twice one document and changes nothing (GC §13)", async () => {
    const first = await importedExport(EXPORT_AUGUST);
    await applyOperations(ctx, fundId, first.id);
    const again = await importedExport(EXPORT_AUGUST);
    expect(again).toMatchObject({ id: first.id, duplicate: true });
    expect((await operationsOf(ctx, fundId)).operations).toHaveLength(3);
  });

  it("recognises the operations of an overlapping export and adds only what is new", async () => {
    const april = await importedExport([FIRST_QUARTER, ENROLLMENT], "aprile.xls");
    await applyOperations(ctx, fundId, april.id);
    const august = await importedExport(EXPORT_AUGUST, "agosto.xls");
    const preview = await previewOperations(ctx, fundId, august.id);
    expect(preview.rows.map((row) => row.state)).toEqual(["new", "known", "known"]);
    expect(await applyOperations(ctx, fundId, august.id)).toEqual({ created: 1, updated: 2 });
    expect((await operationsOf(ctx, fundId)).operations).toHaveLength(3);
  });

  it("fills in the quotation of an operation a first export had left pending", async () => {
    const pending = { ...FIRST_QUARTER, state: "IN LAVORAZIONE", movements: [] };
    const first = await importedExport([pending], "in-lavorazione.xls");
    await applyOperations(ctx, fundId, first.id);
    const second = await importedExport([FIRST_QUARTER], "quotato.xls");
    expect((await previewOperations(ctx, fundId, second.id)).rows[0].state).toBe("changed");
    await applyOperations(ctx, fundId, second.id);
    const { operations, movements } = await operationsOf(ctx, fundId);
    expect(operations).toHaveLength(1);
    expect(operations[0].originalState).toBe("QUOTATO");
    expect(movements).toHaveLength(1);
  });

  it("keeps two identical rows of one export as two operations", async () => {
    const { id } = await importedExport([FIRST_QUARTER, FIRST_QUARTER], "doppia.xls");
    expect(await applyOperations(ctx, fundId, id)).toEqual({ created: 2, updated: 0 });
  });

  it("reads an XLSX the same way", async () => {
    const { document } = await uploadCometaDocument(ctx, "cometa_operations", {
      name: "operazioni.xlsx",
      bytes: twinOperationsXlsx([SECOND_QUARTER]),
    });
    await processCometaDocument(ctx, document.id);
    await applyOperations(ctx, fundId, document.id);
    const { operations } = await operationsOf(ctx, fundId);
    expect(operations[0]).toMatchObject({ netCents: 21_700n, competenceQuarter: 2 });
  });

  it("does not let another user read or apply the document", async () => {
    const { id } = await importedExport(EXPORT_AUGUST);
    const other = await newContext();
    const theirFund = await createPensionFund(other, { name: "Cometa", startOn: "2031-01-01" });
    await expect(previewOperations(other, theirFund.id, id)).rejects.toMatchObject({ code: "not_found" });
    await expect(applyOperations(other, theirFund.id, id)).rejects.toMatchObject({ code: "not_found" });
    await expect(applyOperations(ctx, theirFund.id, id)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("the position summary (plan F6 L3)", () => {
  it("reads every value with its box, and writes the statement and the balance on applying", async () => {
    const id = await importedPosition();
    const evidence = await listEvidence(ctx, id);
    expect(evidence.find((row) => row.field === "value")).toMatchObject({ value: "950.00", page: 1 });
    expect(evidence.find((row) => row.field === "valuationDate")?.value).toBe("2031-08-31");

    const snapshot = await applyPosition(ctx, fundId, id);
    expect(snapshot).toMatchObject({
      valuationDate: "2031-08-31",
      valueCents: 95_000n,
      tfrCents: 60_000n,
      inflowsCents: 89_032n,
      reportedGainCents: 5_968n,
    });
    const detail = await pensionDetail(ctx, fundId);
    expect(detail.metrics.value).toMatchObject({ cents: 95_000n, on: "2031-08-31", source: "statement" });
    const entries = await listBalanceEntries(ctx, detail.fund.valuationAccountId);
    expect(entries[0]).toMatchObject({ on: "2031-08-31", balanceCents: 95_000n, source: "import" });
  });

  it("keeps a correction beside the printed value and applies the correction", async () => {
    const id = await importedPosition();
    await decidePositionField(ctx, id, "value", "951.00");
    const evidence = await listEvidence(ctx, id);
    expect(evidence.find((row) => row.field === "value")).toMatchObject({
      value: "950.00",
      correctedValue: "951.00",
      verification: "corrected",
    });
    const snapshot = await applyPosition(ctx, fundId, id);
    expect(snapshot.valueCents).toBe(95_100n);
  });

  it("keeps an older statement at its own date, and the newest value is the one shown", async () => {
    await applyPosition(ctx, fundId, await importedPosition());
    await applyPosition(ctx, fundId, await importedPosition(POSITION_APRIL, "aprile.pdf"));
    const snapshots = await snapshotsOf(ctx, fundId);
    expect(snapshots.map((row) => row.valuationDate)).toEqual(["2031-08-31", "2031-04-30"]);
    const detail = await pensionDetail(ctx, fundId);
    expect(detail.metrics.value).toMatchObject({ cents: 95_000n, on: "2031-08-31" });
  });

  it("says the value is older than the operations when it is (GC §11.8)", async () => {
    await applyPosition(ctx, fundId, await importedPosition(POSITION_APRIL, "aprile.pdf"));
    const { id } = await importedExport(EXPORT_AUGUST);
    await applyOperations(ctx, fundId, id);
    const detail = await pensionDetail(ctx, fundId);
    expect(detail.valueOlderThanOperations).toBe(true);
    // The credits dated after the statement are not a loss (GC §13).
    expect(detail.metrics.laterCents).toBe(22_000n);
  });
});

describe("what the pages read (plan F6 L4–L6)", () => {
  it("reconciles the payslips with the fund, quarter by quarter", async () => {
    for (const twin of [JANUARY, FEBRUARY, MARCH, THIRTEENTH]) await appliedPayslip(twin);
    const { id } = await importedExport(EXPORT_AUGUST);
    await applyOperations(ctx, fundId, id);
    await applyPosition(ctx, fundId, await importedPosition());
    const detail = await pensionDetail(ctx, fundId);
    const status = (year: number, quarter: number) =>
      detail.quarters.find((one) => one.year === year && one.quarter === quarter);
    expect(status(2031, 1)).toMatchObject({ status: "reconciled", due: "2031-04-20", invested: true });
    expect(status(2031, 1)?.components.find((one) => one.component === "enrollment")).toMatchObject({
      accruedCents: 1_032n,
      creditedCents: 1_032n,
      status: "reconciled",
    });
    // The second quarter was credited and invested although no payslip of it is applied yet.
    expect(status(2031, 2)?.status).toBe("invested");
    expect(status(2031, 4)?.status).toBe("accrued_not_due");
    expect(detail.metrics.paidInCents).toBe(89_032n);
    expect(detail.metrics.gainCents).toBe(5_968n);
    expect(detail.metrics.units).toBe("40.000");
    expect(detail.bridge?.map((line) => line.key)).toContain("market");
  });

  it("keeps a reviewer's accepted difference, and drops it when the difference changes", async () => {
    for (const twin of [JANUARY, FEBRUARY, MARCH]) await appliedPayslip(twin);
    const short: TwinOperation = { ...FIRST_QUARTER, worker: "70,00", net: "652,00" };
    const { id } = await importedExport([short, ENROLLMENT], "corta.xls");
    await applyOperations(ctx, fundId, id);
    const before = await pensionDetail(ctx, fundId);
    expect(before.quarters[0].status).toBe("discrepancy");
    const worker = before.quarters[0].components.find((one) => one.component === "worker")!;
    await decideDifference(ctx, fundId, {
      year: 2031,
      quarter: 1,
      component: "worker",
      decision: "accepted_difference",
      note: "Rounded by the employer; checked against the payslips.",
      differenceCents: worker.differenceCents!,
      accruedCents: worker.accruedCents,
      creditedCents: worker.creditedCents,
      competenceIds: worker.competenceIds,
      operationIds: worker.operationIds,
    });
    const after = await pensionDetail(ctx, fundId);
    expect(after.quarters[0].status).toBe("reconciled");
    expect(after.decisions[0].note).toMatch(/Rounded/);

    // The employer pays the 5,00 it had left out: the difference is no longer the one accepted,
    // so the decision is set aside and the quarter reconciles on its own.
    const arrear: TwinOperation = {
      ...FIRST_QUARTER,
      date: "20/05/2031",
      worker: "5,00",
      employer: "0,00",
      tfr: "0,00",
      fees: "0,00",
      net: "5,00",
      movements: [
        { compartment: "CRESCITA", units: "0,228", unitPrice: "21,900", unitPriceDate: "31/05/2031" },
      ],
    };
    const later = await importedExport([short, ENROLLMENT, arrear], "arretrato.xls");
    await applyOperations(ctx, fundId, later.id);
    const fixed = await pensionDetail(ctx, fundId);
    expect(fixed.quarters[0].status).toBe("reconciled");
    expect(fixed.quarters[0].components[0]).toMatchObject({ differenceCents: 0n, decision: null });
  });

  it("adds a voluntary contribution that raises what was paid in, never the gain", async () => {
    const { id } = await importedExport(EXPORT_AUGUST);
    await applyOperations(ctx, fundId, id);
    await applyPosition(ctx, fundId, await importedPosition());
    const before = await pensionDetail(ctx, fundId);
    const operation = await addVoluntaryContribution(ctx, fundId, {
      on: "2031-08-05",
      amountCents: 10_000n,
      feesCents: 0n,
      note: "Bonifico",
      transactionId: null,
    });
    const after = await pensionDetail(ctx, fundId);
    expect(after.metrics.paidInCents).toBe(before.metrics.paidInCents + 10_000n);
    expect(after.metrics.voluntaryCents).toBe(10_000n);
    expect(after.metrics.gainCents).toBe(before.metrics.gainCents! - 10_000n);
    expect(after.quarters).toEqual(before.quarters);
    await deleteManualOperation(ctx, operation.id);
    expect((await pensionDetail(ctx, fundId)).metrics.paidInCents).toBe(before.metrics.paidInCents);
  });

  it("refuses to delete an operation that came from a document", async () => {
    const { id } = await importedExport([FIRST_QUARTER]);
    await applyOperations(ctx, fundId, id);
    const { operations } = await operationsOf(ctx, fundId);
    await expect(deleteManualOperation(ctx, operations[0].id)).rejects.toMatchObject({ code: "linked" });
  });

  it("reads transfers, switches, withdrawals and voluntary payments without confusing them", async () => {
    const { id } = await importedExport(EXPORT_EXOTIC, "esotiche.xls");
    await applyOperations(ctx, fundId, id);
    const detail = await pensionDetail(ctx, fundId);
    expect(detail.operations.map((operation) => operation.classification)).toEqual([
      "voluntary",
      "transfer_in",
      "switch",
      "withdrawal",
    ]);
    expect(detail.metrics.transfersInCents).toBe(100_000n);
    expect(detail.metrics.withdrawalsCents).toBe(20_000n);
    expect(detail.quarters).toEqual([]);
  });

  it("counts a year's contributions against its deductibility limit, TFR excluded (GC §7)", async () => {
    const { id } = await importedExport(EXPORT_AUGUST);
    await applyOperations(ctx, fundId, id);
    const detail = await pensionDetail(ctx, fundId);
    expect(detail.taxYears).toEqual([
      { year: 2031, workerCents: 10_000n, employerCents: 18_000n, totalCents: 28_000n, limitCents: 530_000n },
    ]);
    expect(detail.tariffs.find((row) => row.item === "management_crescita")?.rate).toBe("0.000800");
  });
});
