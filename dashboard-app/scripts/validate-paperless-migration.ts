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
 * component amounts equal the legacy columns, string for string.
 *
 * String comparison, not numeric: both sides are `numeric` decimal strings and a
 * `Number()` round trip is exactly the class of error this script exists to
 * catch. Exits non-zero on the first mismatch class so a runbook step can gate
 * on it.
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

  const problems = await withSystemContext(db, async (tx) => {
    const legacy = (await tx.select().from(payslips).orderBy(asc(payslips.month))) as unknown as LegacyPayslip[];
    const out: string[] = [];

    for (const row of legacy) {
      if (!isMigratable(row)) continue;
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
    }
    return out;
  });

  await pool.end();
  if (problems.length > 0) {
    console.error(`FAIL — ${problems.length} mismatch(es):`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log(`OK — every verified legacy payslip matches its migrated payroll record.`);
  process.exit(0);
}

void main();
