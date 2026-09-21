// The payslip pipeline end to end (spec §7.8, §9.3) on the synthetic twins, against the real test
// database and the real bucket (under `tests/`, see vitest.config.ts).
import { eq } from "drizzle-orm";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  deleteDocument,
  expireOriginals,
  getDocument,
  ImportError,
  listEvidence,
  readOriginal,
  stuckDocuments,
} from "@/modules/imports/service";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { hasPgError } from "@/platform/db/errors";
import { deleteFolder, ensureBucket, getObject } from "@/platform/storage";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { allDocuments, patchDocument } from "../../../test/documents";
import { newContext } from "../../../test/fixtures";
import {
  APRIL,
  MARCH,
  MARCH_REPRINT,
  MARCH_UNKNOWN_CODE,
  THIRTEENTH,
} from "../../../tests/fixtures/payroll/samples";
import { twinPdf, type TwinPayslip } from "../../../tests/fixtures/payroll/twin";
import { leaveBalanceSnapshots, payrollLeaveEvents, payslips } from "./schema";
import {
  applyPayslip,
  codeMapOf,
  computeState,
  decideField,
  listCodeMap,
  PayrollError,
  payslipsOf,
  processPayslip,
  rejectPayslip,
  resetCode,
  retryPayslip,
  setCodeRole,
  uploadPayslip,
  verifyPayslip,
} from "./service";

let ctx: Ctx;

beforeAll(ensureBucket);
beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
});
afterAll(async () => {
  await deleteFolder("payslips/");
  await closeDatabase();
});

async function imported(twin: TwinPayslip, who: Ctx = ctx) {
  const { document } = await uploadPayslip(who, { name: `${twin.period}.pdf`, bytes: await twinPdf(twin) });
  await processPayslip(who, document.id);
  return document.id;
}

async function applied(twin: TwinPayslip, who: Ctx = ctx) {
  const id = await imported(twin, who);
  await verifyPayslip(who, id);
  await applyPayslip(who, id);
  return id;
}

async function rejects(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy(
    (error) => (error instanceof PayrollError || error instanceof ImportError) && error.code === code,
  );
}

describe("upload and reading (spec §9.3 steps 1–3)", () => {
  it("stores the original under payslips/<user>/, reads it, and waits for review", async () => {
    const id = await imported(MARCH);
    const document = await getDocument(ctx, id);
    expect(document).toMatchObject({ state: "needs_review", kind: "payslip", parserVersion: "reply-teamsystem@1" });
    expect(document?.storageKey).toMatch(new RegExp(`^payslips/${ctx.userId}/\\d{4}/[0-9a-f]{32}\\.pdf$`));
    expect(await getObject(document!.storageKey!)).not.toBeNull();

    const [payslip] = await payslipsOf(ctx);
    expect(payslip).toMatchObject({
      documentId: id,
      type: "ordinary",
      year: 2031,
      period: "2031-03-01",
      employerKey: "01234567890",
      employeeKey: "901",
      active: false,
      gross: 200_000n,
      taxesTotal: 28_023n,
      netPay: 151_100n,
      employeeSocial: 18_380n,
    });
    const evidence = await listEvidence(ctx, id);
    expect(evidence.find((row) => row.field === "netPay")).toMatchObject({
      value: "1511.00",
      origin: "printed",
      verification: "unverified",
      page: 1,
      sourceLabel: "NETTO BUSTA",
    });
    expect(evidence.find((row) => row.field === "gross")).toMatchObject({
      value: "2000.00",
      origin: "derived",
      derivedFrom: ["totalGrossPrinted", "welfareCash"],
    });
  });

  it("makes the same file sent twice one document", async () => {
    const bytes = await twinPdf(MARCH);
    const first = await uploadPayslip(ctx, { name: "a.pdf", bytes });
    const again = await uploadPayslip(ctx, { name: "b.pdf", bytes });
    expect(again).toMatchObject({ duplicate: true, document: { id: first.document.id } });
    expect(await allDocuments()).toHaveLength(1);
  });

  it("refuses what is not a PDF, whatever its name, and an empty file", async () => {
    await rejects(uploadPayslip(ctx, { name: "fake.pdf", bytes: new TextEncoder().encode("hello") }), "unsupported_format");
    await rejects(uploadPayslip(ctx, { name: "empty.pdf", bytes: new Uint8Array() }), "empty");
    expect(await allDocuments()).toHaveLength(0);
  });

  it("sends a PDF without a text layer to needs_ocr (spec D11)", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText("1", { x: 10, y: 10, size: 10, font: await pdf.embedFont(StandardFonts.Courier) });
    const { document } = await uploadPayslip(ctx, { name: "scan.pdf", bytes: await pdf.save() });
    expect(await processPayslip(ctx, document.id)).toMatchObject({ state: "needs_ocr" });
    expect(await payslipsOf(ctx)).toEqual([]);
  });

  it("fails a document whose original is gone, with a code, and reads it again on Retry", async () => {
    const id = await imported(MARCH);
    const document = await getDocument(ctx, id);
    await patchDocument(id, { storageKey: null, originalDeletedAt: new Date() });
    expect(await retryPayslip(ctx, id)).toMatchObject({ state: "failed", error: "original_missing" });
    await patchDocument(id, { storageKey: document!.storageKey, originalDeletedAt: null });
    expect(await retryPayslip(ctx, id)).toMatchObject({ state: "needs_review", error: null });
  });

  it("lets the hourly sweep take over a reading that died, and only an old one", async () => {
    const { document } = await uploadPayslip(ctx, { name: "m.pdf", bytes: await twinPdf(MARCH) });
    await patchDocument(document.id, { state: "extracting" });
    const now = new Date();
    expect(await stuckDocuments(ctx, ["payslip"], now)).toEqual([]);
    expect(await processPayslip(ctx, document.id, { stuckBefore: new Date(now.getTime() - 60_000) })).toBeNull();

    const later = new Date(now.getTime() + 20 * 60_000);
    expect((await stuckDocuments(ctx, ["payslip"], later)).map((one) => one.id)).toEqual([document.id]);
    expect(await processPayslip(ctx, document.id, { stuckBefore: new Date(later.getTime() - 10 * 60_000) })).toMatchObject({
      state: "needs_review",
    });
  });
});

describe("review (spec §7.8, §9.3 step 4)", () => {
  it("keeps the original beside a correction, re-runs the checks, and blocks verifying a failed one", async () => {
    const id = await imported(MARCH);
    const state = await decideField(ctx, id, "netPay", "1512.00");
    expect(state.assembled.checks.find((check) => check.id === "net")).toMatchObject({
      status: "failed",
      expected: "1511.00",
      actual: "1512.00",
    });
    const evidence = (await listEvidence(ctx, id)).find((row) => row.field === "netPay");
    expect(evidence).toMatchObject({
      value: "1511.00",
      correctedValue: "1512.00",
      verification: "corrected",
      correctedBy: ctx.userId,
    });
    expect((await payslipsOf(ctx))[0].netPay).toBe(151_200n);
    await rejects(verifyPayslip(ctx, id), "blocking_checks");

    // Correcting it back to what was read is a confirmation.
    await decideField(ctx, id, "netPay", "1511.00");
    expect((await listEvidence(ctx, id)).find((row) => row.field === "netPay")).toMatchObject({
      verification: "confirmed",
      correctedValue: null,
    });
    await verifyPayslip(ctx, id);
    expect((await getDocument(ctx, id))?.state).toBe("verified");
  });

  it("lets a person verify despite a failed check only by acknowledging it", async () => {
    const id = await imported(MARCH);
    await decideField(ctx, id, "netPay", "1512.00");
    await verifyPayslip(ctx, id, { acknowledgeFailures: true });
    expect((await getDocument(ctx, id))?.state).toBe("verified");
    // A change after verifying sends it back to review.
    await decideField(ctx, id, "roundingCurrent", "0.43");
    expect((await getDocument(ctx, id))?.state).toBe("needs_review");
  });

  it("never sets a derived value by hand, and refuses a value that is not one", async () => {
    const id = await imported(MARCH);
    await rejects(decideField(ctx, id, "gross", "1.00"), "derived_field");
    await rejects(decideField(ctx, id, "netPay", "12,5"), "invalid_value");
    await rejects(decideField(ctx, id, "printedOn", "2031-02-30"), "invalid_value");
    await rejects(decideField(ctx, id, "nonsense", "1.00"), "invalid_value");
  });

  it("does not apply what was not verified", async () => {
    const id = await imported(MARCH);
    await rejects(applyPayslip(ctx, id), "invalid_state");
  });

  it("sets a document aside on reject, and reads it again on Retry", async () => {
    const id = await imported(MARCH);
    await rejectPayslip(ctx, id);
    expect((await getDocument(ctx, id))?.state).toBe("rejected");
    expect(await payslipsOf(ctx)).toEqual([]);
    expect(await retryPayslip(ctx, id)).toMatchObject({ state: "needs_review" });
    expect(await payslipsOf(ctx)).toHaveLength(1);
  });

  it("deletes a document nothing was applied from, with its original", async () => {
    const id = await imported(MARCH);
    const key = (await getDocument(ctx, id))!.storageKey!;
    await deleteDocument(ctx, id);
    expect(await getDocument(ctx, id)).toBeNull();
    expect(await getObject(key)).toBeNull();
  });
});

describe("applying (spec §7.8 \"Applicazione\")", () => {
  it("writes the leave snapshots and the events, in the month the leave was used", async () => {
    const id = await applied(MARCH);
    const [payslip] = await payslipsOf(ctx);
    expect(payslip).toMatchObject({ documentId: id, active: true });
    expect((await getDocument(ctx, id))?.state).toBe("applied");
    const snapshots = await getDb()
      .select()
      .from(leaveBalanceSnapshots)
      .where(eq(leaveBalanceSnapshots.payslipId, payslip.id))
      .orderBy(leaveBalanceSnapshots.kind);
    expect(snapshots.map(({ kind, previousYear, accrued, used, remaining, period }) => ({ kind, previousYear, accrued, used, remaining, period }))).toEqual([
      { kind: "rol", previousYear: "10.00", accrued: "20.00", used: null, remaining: "30.00", period: "2031-03-01" },
      { kind: "vacation", previousYear: "5.00", accrued: "40.00", used: null, remaining: "45.00", period: "2031-03-01" },
    ]);
    const events = await getDb().select().from(payrollLeaveEvents);
    expect(events).toEqual([
      expect.objectContaining({ kind: "vacation", hours: "8.00", payrollPeriod: "2031-03-01", usagePeriod: "2031-02-01" }),
    ]);
    expect(events[0].sourceLineIds).toHaveLength(1);
  });

  it("confirms a permit as ROL against the payslip before, whichever is applied first", async () => {
    await applied(APRIL);
    const kinds = async () => (await getDb().select().from(payrollLeaveEvents)).map((event) => event.kind).sort();
    expect(await kinds()).toEqual(["permit"]);
    await applied(MARCH);
    expect(await kinds()).toEqual(["rol", "vacation"]);
  });

  it("supersedes the active payslip on a rectification — replaced, never summed", async () => {
    const original = await applied(MARCH);
    const reprint = await imported(MARCH_REPRINT);
    const state = await computeState(ctx, reprint);
    expect(state.warnings).toContainEqual({ code: "rectification", detail: { documentId: original } });
    await verifyPayslip(ctx, reprint);
    await applyPayslip(ctx, reprint);

    expect((await getDocument(ctx, original))?.state).toBe("superseded");
    const rows = await payslipsOf(ctx);
    expect(rows.filter((row) => row.active).map((row) => row.documentId)).toEqual([reprint]);
    const old = rows.find((row) => row.documentId === original)!;
    expect(old.supersededBy).toBe(rows.find((row) => row.documentId === reprint)!.id);
    // One set of leave: the superseded payslip's went with it.
    expect(await getDb().select().from(payrollLeaveEvents)).toHaveLength(1);
    expect(
      await getDb().select().from(leaveBalanceSnapshots).where(eq(leaveBalanceSnapshots.payslipId, old.id)),
    ).toEqual([]);
  });

  it("keeps a 13th apart from December and gives it no leave (acceptance 2, 6)", async () => {
    await applied(THIRTEENTH);
    const [payslip] = await payslipsOf(ctx);
    expect(payslip).toMatchObject({ type: "thirteenth", period: null, active: true, employerFundEffective: null });
    expect(await getDb().select().from(payrollLeaveEvents)).toEqual([]);
    expect(await getDb().select().from(leaveBalanceSnapshots)).toEqual([]);
  });

  it("allows one active payslip per logical key, in the database too", async () => {
    await applied(MARCH);
    const second = await imported(MARCH_UNKNOWN_CODE);
    await expect(
      getDb()
        .update(payslips)
        .set({ active: true, appliedAt: new Date() })
        .where(eq(payslips.documentId, second)),
    ).rejects.toSatisfy((error) => hasPgError(error, "23505", "payslips_active_key_uq"));
  });
});

describe("the code map (spec §7.8 \"Mappa dei codici\")", () => {
  it("is seeded with the Reply/TeamSystem profile, and flags a code it lacks until it is mapped", async () => {
    expect((await codeMapOf(ctx)).get("7101")).toBe("employee_fund");
    const id = await imported(MARCH_UNKNOWN_CODE);
    expect((await computeState(ctx, id)).warnings).toContainEqual({ code: "unknown_code", detail: { code: "5555" } });

    await setCodeRole(ctx, { code: "5555", role: "statistical", note: "Voce di prova" });
    expect((await computeState(ctx, id)).warnings.map((warning) => warning.code)).not.toContain("unknown_code");
    await resetCode(ctx, "5555");
    expect((await listCodeMap(ctx)).map((entry) => entry.code)).not.toContain("5555");

    await setCodeRole(ctx, { code: "7101", role: "statistical" });
    await resetCode(ctx, "7101");
    expect((await codeMapOf(ctx)).get("7101")).toBe("employee_fund");
    await rejects(setCodeRole(ctx, { code: "abc", role: "statistical" }), "invalid_value");
    await rejects(setCodeRole(ctx, { code: "1", role: "salary" }), "invalid_value");
  });
});

describe("retention (spec §9.3 step 6)", () => {
  it("deletes originals past their retention and keeps the data read from them", async () => {
    const id = await imported(MARCH);
    const key = (await getDocument(ctx, id))!.storageKey!;
    expect(await expireOriginals(ctx)).toBe(0);
    await patchDocument(id, { retainUntil: "2020-01-01" });
    expect(await expireOriginals(ctx)).toBe(1);
    expect(await getObject(key)).toBeNull();
    expect(await getDocument(ctx, id)).toMatchObject({ storageKey: null, state: "needs_review" });
    expect(await readOriginal(ctx, id)).toBeNull();
    expect((await listEvidence(ctx, id)).length).toBeGreaterThan(0);
  });
});

describe("isolation between users (spec §4.4, §11)", () => {
  it("never reads, reviews, applies or deletes another user's payslip", async () => {
    const id = await imported(MARCH);
    const other = await newContext();
    expect(await getDocument(other, id)).toBeNull();
    expect(await readOriginal(other, id)).toBeNull();
    expect(await listEvidence(other, id)).toEqual([]);
    expect(await payslipsOf(other)).toEqual([]);
    await rejects(decideField(other, id, "netPay", "1.00"), "not_found");
    await rejects(verifyPayslip(other, id), "not_found");
    await rejects(applyPayslip(other, id), "not_found");
    await rejects(rejectPayslip(other, id), "not_found");
    await rejects(retryPayslip(other, id), "not_found");
    await rejects(deleteDocument(other, id), "not_found");
    expect(await processPayslip(other, id)).toBeNull();

    // The same file is a document of its own for someone else.
    const theirs = await uploadPayslip(other, { name: "m.pdf", bytes: await twinPdf(MARCH) });
    expect(theirs.duplicate).toBe(false);
    expect(theirs.document.id).not.toBe(id);
    expect(await allDocuments(ctx.userId)).toHaveLength(1);
  });
});
