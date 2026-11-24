// A payslip typed by hand, the employer's extra payments and the fields as pairs (rewrite plan R5g,
// ST-21, E4, E6), against the real test database and bucket.
import { and, eq } from "drizzle-orm";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDocument } from "../imports/service";
import type { Ctx } from "../../platform/context";
import { getDb } from "../../platform/db/client";
import { deleteFolder, ensureBucket } from "../../platform/storage";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { newContext } from "../../../../../test/fixtures";
import { MARCH } from "../../../../../test/fixtures/payroll/samples";
import { twinPdf } from "../../../../../test/fixtures/payroll/twin";
import { registerView } from "./queries";
import { COUNTRY_FIELDS } from "./rules";
import { payslipFields, payslips } from "./schema";
import {
  applyPayslip,
  createManualPayslip,
  deleteManualPayslip,
  deletePayslip,
  employerOf,
  manualPayslipView,
  PayrollError,
  processPayslip,
  reopenPayslip,
  saveEmployer,
  updateManualPayslip,
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

const manual = (overrides: object = {}) => ({
  kind: "ordinary",
  year: 2031,
  month: 3,
  extraNumber: null,
  paidOn: "2031-03-27",
  gross: 300_000n,
  taxes: 60_000n,
  contributions: 28_000n,
  net: 210_000n,
  fields: {},
  documentId: null,
  ...overrides,
});

async function rejects(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((error) => error instanceof PayrollError && error.code === code);
}

/** A PDF with text no profile recognises: read, it waits in review with no payslip. */
async function unknownDocument(): Promise<string> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let line = 0; line < 12; line += 1) {
    page.drawText(`A payslip of another employer, line ${line}, with nothing a profile knows.`, {
      x: 40,
      y: 760 - line * 20,
      size: 10,
      font,
    });
  }
  const { document } = await uploadPayslip(ctx, { name: "other.pdf", bytes: await pdf.save() });
  await processPayslip(ctx, document.id);
  return document.id;
}

describe("a payslip typed by hand (ST-21)", () => {
  it("enters the year's register and the KPIs at once, with no profile and no document", async () => {
    await createManualPayslip(ctx, manual());
    await createManualPayslip(ctx, manual({ month: 4, gross: 310_000n, net: 220_000n }));
    const view = await registerView(ctx);
    expect(view.applied).toBe(2);
    expect(view.years).toHaveLength(1);
    const [year] = view.years;
    expect(year.rows.map((row) => [row.payslip.period, row.payslip.source, row.document])).toEqual([
      ["2031-04-01", "manual", null],
      ["2031-03-01", "manual", null],
    ]);
    expect(year.totals.gross).toBe(610_000n);
    expect(year.totals.taxesTotal).toBe(120_000n);
    expect(year.totals.employeeSocial).toBe(56_000n);
    expect(view.kpis.net3).toBe(215_000n);
    // Without a configuration one extra payment in December is expected: 12 mean months and one more.
    expect(view.kpis.ral).toEqual({ cents: 305_000n * 13n, basis: "estimate", year: 2031 });
  });

  it("writes the old type beside the kind, and an extra payment of the employer by its number", async () => {
    await saveEmployer(ctx, { payFrequency: "monthly", extraMonths: [12, 6] });
    const payslip = await createManualPayslip(ctx, manual({ kind: "extra", month: null, extraNumber: 2 }));
    expect(payslip).toMatchObject({ kind: "extra", extraNumber: 2, type: "fourteenth", period: null, active: true });
    expect(await employerOf(ctx)).toEqual({ payFrequency: "monthly", extraMonths: [12, 6], configured: true });
  });

  it("stores its fields as pairs and in the old columns, and the register sums them", async () => {
    const payslip = await createManualPayslip(ctx, manual({ fields: { irpefGross: 65_000n, tfrSelected: 20_000n } }));
    expect(payslip.irpefGross).toBe(65_000n);
    const view = await manualPayslipView(ctx, payslip.id);
    expect(view?.fields).toEqual({ irpefGross: 65_000n, tfrSelected: 20_000n });
    const [year] = (await registerView(ctx)).years;
    expect(year.totals.irpefGross).toBe(65_000n);
    expect(year.totals.tfrSelected).toBe(20_000n);
  });

  it("refuses a second payslip of the same month, and amounts that do not hold", async () => {
    await createManualPayslip(ctx, manual());
    await rejects(createManualPayslip(ctx, manual()), "month_applied");
    await rejects(createManualPayslip(ctx, manual({ month: 5, net: 300_001n })), "invalid_value");
    await rejects(createManualPayslip(ctx, manual({ kind: "extra", month: null, extraNumber: 4 })), "invalid_value");
  });

  it("is changed in place and deleted, leaving the register", async () => {
    const payslip = await createManualPayslip(ctx, manual({ fields: { irpefGross: 1n } }));
    await updateManualPayslip(ctx, payslip.id, manual({ month: 2, gross: 280_000n, net: 200_000n }));
    const changed = await manualPayslipView(ctx, payslip.id);
    expect(changed?.payslip).toMatchObject({ period: "2031-02-01", gross: 280_000n, irpefGross: null });
    expect(changed?.fields).toEqual({});
    expect(await deleteManualPayslip(ctx, payslip.id)).toEqual({ deletedDocument: false });
    expect((await registerView(ctx)).years).toEqual([]);
    await rejects(deleteManualPayslip(ctx, payslip.id), "not_found");
  });

  it("takes a document read without a profile, which is applied with it and deleted with it", async () => {
    const documentId = await unknownDocument();
    expect((await getDocument(ctx, documentId))?.state).toBe("needs_review");
    const payslip = await createManualPayslip(ctx, manual({ documentId }));
    expect((await getDocument(ctx, documentId))?.state).toBe("applied");
    const view = await registerView(ctx);
    expect(view.inbox).toEqual([]);
    expect(view.awaiting).toBe(0);
    expect(view.years[0].rows[0].document?.id).toBe(documentId);
    // It has no review to go back to, and the review's delete takes the manual payslip with it.
    await rejects(reopenPayslip(ctx, documentId), "invalid_state");
    expect(await deletePayslip(ctx, documentId)).toEqual({ unapplied: true, restored: false });
    expect(await getDocument(ctx, documentId)).toBeNull();
    expect(await manualPayslipView(ctx, payslip.id)).toBeNull();
  });

  it("leaves its document in the inbox when the month is already applied", async () => {
    await createManualPayslip(ctx, manual());
    const documentId = await unknownDocument();
    await rejects(createManualPayslip(ctx, manual({ documentId })), "month_applied");
    expect((await getDocument(ctx, documentId))?.state).toBe("needs_review");
    expect((await registerView(ctx)).inbox.map((row) => row.id)).toContain(documentId);
  });

  it("refuses a document that already has a payslip", async () => {
    const { document } = await uploadPayslip(ctx, { name: "march.pdf", bytes: await twinPdf(MARCH) });
    await processPayslip(ctx, document.id);
    await rejects(createManualPayslip(ctx, manual({ month: 6, documentId: document.id })), "conflict");
  });
});

describe("a payslip read with a profile (E4)", () => {
  it("writes the fields of the pack as pairs equal to its columns", async () => {
    const { document } = await uploadPayslip(ctx, { name: "march.pdf", bytes: await twinPdf(MARCH) });
    await processPayslip(ctx, document.id);
    const [payslip] = await getDb().select().from(payslips).where(eq(payslips.documentId, document.id));
    expect(payslip).toMatchObject({ kind: "ordinary", extraNumber: null, source: "read" });
    const pairs = await getDb()
      .select({ key: payslipFields.key, value: payslipFields.valueCents })
      .from(payslipFields)
      .where(and(eq(payslipFields.payslipId, payslip.id)));
    expect(pairs.length).toBeGreaterThan(0);
    for (const pair of pairs) {
      expect(COUNTRY_FIELDS.map((field) => field.key)).toContain(pair.key);
      expect(payslip[pair.key as keyof typeof payslip]).toBe(pair.value);
    }
    expect(pairs.map((pair) => pair.key)).toContain("irpefGross");
  });

  it("is refused over a month typed by hand", async () => {
    await createManualPayslip(ctx, manual());
    const { document } = await uploadPayslip(ctx, { name: "march.pdf", bytes: await twinPdf(MARCH) });
    await processPayslip(ctx, document.id);
    await verifyPayslip(ctx, document.id);
    await rejects(applyPayslip(ctx, document.id), "conflict");
  });
});
