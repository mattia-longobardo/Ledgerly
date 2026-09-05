import type { FieldExtraction, PayslipExtraction, PayslipField } from "@/lib/contracts";
import type { PayrollRecordKind } from "../application/ports";
import { periodFor, recordKindOf } from "../domain/period";

/** Exactly the columns the migration reads. Declared here so the script needs no Drizzle row type. */
export interface LegacyPayslip {
  id: number;
  month: string;
  isThirteenth: boolean;
  paperlessDocId: number;
  status: string;
  rawExtraction: unknown;
  corrections: unknown;
  gross: string | null;
  net: string | null;
  taxes: string | null;
  fundContribEmployee: string | null;
  fundContribEmployer: string | null;
  ferieBalance: string | null;
  rolBalance: string | null;
  ferieTaken: string | null;
  rolTaken: string | null;
  verifiedAt: Date | null;
}

export interface MappedImport {
  fileName: string;
  extraction: PayslipExtraction;
  verifiedAt: Date | null;
  kind: PayrollRecordKind;
  periodStart: string;
  periodEnd: string;
  legacySource: { provider: "paperless"; documentId: number; payslipId: number };
}

/**
 * Spec §10.2 step 2 migrates the **verified** rows. A `parsed` row was never
 * confirmed by a human, and carrying it across would put unreviewed figures
 * straight into Earnings; a `discovered` row has no figures at all. Both are
 * left in the frozen legacy table, where they remain visible.
 */
export function isMigratable(row: LegacyPayslip): boolean {
  return row.status === "verified";
}

const IT_MONTH_NAMES = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];

/**
 * The filename the migrated import gets. It matters: `titleMonth` reads the
 * period back out of it (Task 4), so a re-ingest of the same document would
 * land on the same month rather than on whatever the OCR latches onto.
 */
function fileNameFor(row: LegacyPayslip): string {
  const year = row.month.slice(0, 4);
  if (row.isThirteenth) return `Tredicesima ${year}.pdf`;
  const monthIndex = Number(row.month.slice(5, 7)) - 1;
  return `Busta Paga ${IT_MONTH_NAMES[monthIndex]} ${year}.pdf`;
}

/**
 * The legacy column names and the parser's field codes are not the same
 * vocabulary — `ferie_taken` versus `ferieTakenHours`, and no legacy column at
 * all for `permessiBalance`. This is the whole mapping, in one place.
 */
const COLUMN_TO_FIELD: ReadonlyArray<[keyof LegacyPayslip, PayslipField]> = [
  ["gross", "gross"],
  ["net", "net"],
  ["taxes", "taxes"],
  ["fundContribEmployee", "fundContribEmployee"],
  ["fundContribEmployer", "fundContribEmployer"],
  ["ferieBalance", "ferieBalance"],
  ["rolBalance", "rolBalance"],
  ["ferieTaken", "ferieTakenHours"],
  ["rolTaken", "rolTakenHours"],
];

/**
 * A verified legacy payslip, in the shape the new pipeline's apply step reads.
 *
 * Every carried value is `high` confidence and attributed to `rules`, because a
 * human confirmed it once already — re-reviewing twelve payslips somebody has
 * already checked would be busywork with a real chance of introducing an error.
 * A column that was null stays **absent**, never `0.00`: the "never invent
 * financial data" rule applies to a migration exactly as it does to a parse.
 */
export function mapLegacyPayslip(row: LegacyPayslip): MappedImport {
  const fields: Partial<Record<PayslipField, FieldExtraction<number | null>>> = {};
  for (const [column, field] of COLUMN_TO_FIELD) {
    const raw = row[column] as string | null;
    if (raw === null) continue;
    const value = Number(raw);
    fields[field] = { value, confidence: "high", rules: value, llm: null, note: "migrated from Paperless" };
  }

  const period = periodFor(row.month);
  return {
    fileName: fileNameFor(row),
    extraction: {
      // Deliberately not `PARSER_VERSION`: these values did not come out of the
      // current engine, and stamping them with its version would make a future
      // "re-parse everything below version X" sweep skip them wrongly.
      parserVersion: "migration-paperless-1",
      month: row.month,
      isThirteenth: row.isThirteenth,
      textSource: "pdf",
      fields,
      checks: [
        { id: "migrated", label: "migration", passed: true, detail: "values carried over from the verified Paperless row" },
      ],
    },
    verifiedAt: row.verifiedAt,
    kind: recordKindOf(row.isThirteenth),
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    legacySource: { provider: "paperless", documentId: row.paperlessDocId, payslipId: row.id },
  };
}
