import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import { deleteFolder, ensureBucket, getObject, putObject } from "@/platform/storage";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { newContext } from "../../../test/fixtures";
import { importedOperation, importedPosition, payrollFund } from "../../../test/funds";
import { deleteRetiredDocuments, retiredCount, retiredDocuments } from "./retired";
import { documents } from "./schema";

// Step A4 of release N6: the documents a fund's import left are deleted, files first and rows after,
// and what was read from them stays the fund's data.

let ctx: Ctx;

async function aDocument(kind: "payslip" | "cometa_operations" | "cometa_position", folder: string) {
  const bytes = new TextEncoder().encode(`${kind} ${randomUUID()}`);
  const storageKey = `${folder}/${ctx.userId}/2026/${randomUUID().replaceAll("-", "")}.pdf`;
  await putObject(storageKey, bytes, "application/pdf");
  const [row] = await getDb()
    .insert(documents)
    .values(
      userScoped(ctx).stamp({
        kind,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        fileName: `${kind}.pdf`,
        mime: "application/pdf",
        sizeBytes: bytes.length,
        storageKey,
        state: "applied" as const,
        retainUntil: "2036-01-01",
      }),
    )
    .returning();
  return row;
}

beforeEach(async () => {
  await ensureBucket();
  await resetDatabase();
  ctx = await newContext();
});

afterAll(async () => {
  // Nothing of the test stays in the bucket.
  await deleteFolder("retired-test/");
  await deleteFolder(`payslips/${ctx.userId}/`);
  await closeDatabase();
});

describe("the documents of the kinds nothing reads (N6, step A4)", () => {
  it("deletes the originals and the rows, and leaves what was read from them", async () => {
    const fund = await payrollFund(ctx, { name: "Fondo Alfa", startOn: "2026-01-01" });
    const operations = await aDocument("cometa_operations", "retired-test");
    const position = await aDocument("cometa_position", "retired-test");
    const payslip = await aDocument("payslip", "payslips");
    const operation = await importedOperation(ctx, fund.id, {
      originKey: "export:1",
      originalType: "Contributo",
      classification: "contribution",
      competenceYear: 2026,
      competenceQuarter: 1,
      operationDate: "2026-04-20",
      workerCents: 10_000n,
      employerCents: 18_000n,
      tfrCents: 60_000n,
      feesCents: 300n,
      netCents: 87_700n,
      movements: [{ compartment: "Crescita", units: "83.5", unitPrice: "10.5", unitPriceDate: "2026-04-20" }],
    });
    // The fund's tables are another module's: this test reads and writes them as SQL.
    await getDb().execute(
      sql`update fund_operations set document_id = ${operations.id} where id = ${operation.id}`,
    );
    await importedPosition(ctx, fund, { valuationDate: "2026-04-30", valueCents: 181_200n });
    await getDb().execute(sql`update position_snapshots set document_id = ${position.id}`);
    const figures = async () =>
      (
        await getDb().execute(
          sql`select id, operation_date, worker_cents, employer_cents, tfr_cents, fees_cents, net_cents,
                     competence_year, competence_quarter, classification, source
              from fund_operations order by id`,
        )
      ).rows;
    const before = await figures();
    expect(before).toHaveLength(1);

    expect((await retiredDocuments()).map((one) => one.id).sort()).toEqual(
      [operations.id, position.id].sort(),
    );
    // A number that is not the one the operator saw deletes nothing.
    await expect(deleteRetiredDocuments(3)).rejects.toThrow(RangeError);
    expect(await retiredCount()).toBe(2);
    expect(await getObject(operations.storageKey!)).not.toBeNull();

    expect(await deleteRetiredDocuments(2)).toEqual({ files: 2, rows: 2 });
    expect(await retiredCount()).toBe(0);
    expect(await getObject(operations.storageKey!)).toBeNull();
    expect(await getObject(position.storageKey!)).toBeNull();
    // The payslip and its original are not of a retired kind.
    expect((await getDb().select().from(documents)).map((one) => one.id)).toEqual([payslip.id]);
    expect(await getObject(payslip.storageKey!)).not.toBeNull();
    // The operation and the position keep every figure; only the pointer to the document is gone.
    expect(await figures()).toEqual(before);
    const pointers = await getDb().execute(
      sql`select (select document_id from fund_operations limit 1) as operation,
                 (select document_id from position_snapshots limit 1) as position,
                 (select value_cents from position_snapshots limit 1) as value,
                 (select count(*)::int from unit_movements) as movements`,
    );
    expect(pointers.rows[0]).toEqual({ operation: null, position: null, value: "181200", movements: 1 });
  });

  it("does nothing, and says so, when there is none", async () => {
    expect(await deleteRetiredDocuments(0)).toEqual({ files: 0, rows: 0 });
  });
});
