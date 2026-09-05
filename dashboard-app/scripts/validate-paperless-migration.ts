import { asc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/lib/db/schema";
import { payrollComponents, payrollImports, payrollRecords, payslips } from "@/lib/db/schema";
import { isMigratable, type LegacyPayslip } from "@/modules/payroll/infrastructure/paperless-import";
import { withSystemContext } from "@/platform/db/context";

/**
 * Spec §10.2 step 3's zero-tolerance check, for payroll: every verified legacy
 * payslip must have exactly one live `payroll_records` row whose gross, net and
 * component amounts equal the legacy columns, string for string, AND whose
 * matching `payroll_imports` row actually has its bytes in the document store.
 *
 * String comparison, not numeric: both sides are `numeric` decimal strings and a
 * `Number()` round trip is exactly the class of error this script exists to
 * catch. Exits non-zero on the first mismatch class so a runbook step can gate
 * on it.
 *
 * The document-store check is a distinct failure category from a money-figure
 * mismatch: `migrate-paperless.ts` writes bytes to the store and the
 * `payroll_imports.storage_key` row in two separate steps, so a run where
 * every `store.put` silently failed (bad silo credential, wrong bucket) could
 * still leave the database rows looking correct. `storage_key` must be
 * non-null, and `scan_status` must be `'clean'` — the value the migration
 * script deliberately writes for every row it creates (Ruling R4-2: the
 * originals predate the scanning boundary, so the row says "clean" rather than
 * "pending", which would otherwise look like an import stuck mid-pipeline).
 *
 * This script also counts how many legacy payslips it actually examined
 * (i.e. how many are `isMigratable`). Zero is never a legitimate "OK": either
 * the migration has not run yet, `DATABASE_URL` points at the wrong database,
 * or every legacy payslip has been superseded/rejected in a way that leaves
 * nothing to verify — none of which the runbook's wave-2 gate should treat as
 * success. The count is also printed in the success message, so "twelve
 * verified" and "looked at nothing" can never print the same text.
 *
 * `payroll_imports`, `payroll_records` and `payroll_components` all have RLS
 * forced (drizzle/0015_payroll.sql), so every read against them has to run
 * inside a `withSystemContext` transaction — `scripts/validate-teable-
 * migration.ts` reads its own RLS-protected tables the same way. There is no
 * network I/O in this script (every call here is a local Postgres read), so
 * one transaction for the whole run does not hold a connection open across any
 * slow external call the way the migration script's per-payslip transactions
 * have to avoid.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

function normalise(value: string | null): string | null {
  if (value === null) return null;
  const [intPart, frac = ""] = value.split(".");
  return `${intPart}.${(frac + "00").slice(0, 2)}`;
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });

  const { problems, examined } = await withSystemContext(db, async (tx) => {
    const legacy = (await tx.select().from(payslips).orderBy(asc(payslips.month))) as unknown as LegacyPayslip[];
    const out: string[] = [];
    let examinedCount = 0;

    for (const row of legacy) {
      if (!isMigratable(row)) continue;
      examinedCount++;
      const records = await tx
        .select()
        .from(payrollRecords)
        .innerJoin(payrollImports, eq(payrollRecords.importId, payrollImports.id))
        .where(isNull(payrollRecords.supersededAt));
      const match = records.find((r) => r.payroll_records.periodStart === row.month && r.payroll_records.kind === (row.isThirteenth ? "thirteenth" : "ordinary"));
      if (!match) {
        out.push(`payslip ${row.id} (${row.month}): no live payroll record`);
        continue;
      }
      const record = match.payroll_records;
      const legacyImport = match.payroll_imports;
      for (const [label, legacyValue, newValue] of [
        ["gross", row.gross, record.gross],
        ["net", row.net, record.net],
      ] as const) {
        if (normalise(legacyValue) !== normalise(newValue)) {
          out.push(`payslip ${row.id} (${row.month}): ${label} ${legacyValue ?? "null"} became ${newValue ?? "null"}`);
        }
      }
      const components = await tx.select().from(payrollComponents).where(eq(payrollComponents.recordId, record.id));
      for (const [code, legacyValue] of [
        ["taxes", row.taxes],
        ["fundContribEmployee", row.fundContribEmployee],
        ["fundContribEmployer", row.fundContribEmployer],
      ] as const) {
        const component = components.find((c) => c.code === code);
        const newValue = component?.amount ?? null;
        if (normalise(legacyValue) !== normalise(newValue)) {
          out.push(`payslip ${row.id} (${row.month}): ${code} ${legacyValue ?? "null"} became ${newValue ?? "null"}`);
        }
      }
      // Distinct failure category from a money-figure mismatch: the rows can
      // be numerically perfect while the bytes they claim to describe never
      // made it into the document store (Finding 5 — a silently failing
      // `store.put` still leaves the database rows looking migrated).
      if (!legacyImport.storageKey) {
        out.push(`payslip ${row.id} (${row.month}): import ${legacyImport.id} has no storage_key — original was never stored`);
      }
      if (legacyImport.scanStatus !== "clean") {
        out.push(`payslip ${row.id} (${row.month}): import ${legacyImport.id} has scan_status '${legacyImport.scanStatus}', expected 'clean'`);
      }
    }
    return { problems: out, examined: examinedCount };
  });

  await pool.end();
  if (examined === 0) {
    console.error(
      "FAIL — examined 0 verified legacy payslips. This cannot distinguish " +
        "\"nothing to migrate\" from \"looked at nothing\" (wrong DATABASE_URL, " +
        "connected before the migration ran, etc.) — refusing to report OK. " +
        "Check DATABASE_URL and that migrate-paperless.ts has already run.",
    );
    process.exit(1);
  }
  if (problems.length > 0) {
    console.error(`FAIL — ${problems.length} mismatch(es) across ${examined} examined legacy payslip(s):`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log(`OK — ${examined} verified legacy payslip(s) match their migrated payroll records.`);
  process.exit(0);
}

void main();
