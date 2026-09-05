import { PAYSLIP_FIELDS, type Confidence, type PayslipField, type SanityCheck } from "@/lib/contracts";
import { NotFoundError } from "../application/errors";
import { getImport, listImports } from "../application/list-imports";
import type { PayrollImport } from "../application/ports";
import type { QueueEntry } from "./queue";
import { orderQueue } from "./queue";
import { runForPrincipal } from "./run";

/** Flat and serialisable: this crosses the server/client boundary. */
export interface ImportRow {
  id: string;
  fileName: string;
  status: string;
  scanStatus: string;
  /** From the extraction. `null` until the parser has read one — never a placeholder date. */
  month: string | null;
  /** From the extraction. `null` when the parser could not read a net — never `0.00`. */
  net: string | null;
  createdAt: string;
  version: number;
}

export interface ReviewField {
  name: PayslipField;
  label: string;
  hint: string;
  unit: "eur" | "hours";
  /** Pre-filled from the extraction; the empty string when the parser read nothing. */
  initial: string;
  confidence: Confidence;
  rules: number | null;
  llm: number | null;
}

export interface ReviewData {
  import: ImportRow;
  fields: ReviewField[];
  checks: SanityCheck[];
  /** Every import still awaiting a decision, this one included, in queue order. */
  pending: QueueEntry[];
  month: string;
  isThirteenth: boolean;
  version: number;
}

/**
 * The Italian labels and the English hints the review screen shows beside each
 * field. The label is the payslip's own wording (data, spec §2.9); the hint is
 * UI chrome and is therefore English.
 */
const FIELD_META: Record<PayslipField, { label: string; hint: string; unit: "eur" | "hours" }> = {
  gross: { label: "Totale competenze", hint: "Gross for the period", unit: "eur" },
  net: { label: "Netto del mese", hint: "Net paid", unit: "eur" },
  taxes: { label: "Totale trattenute", hint: "Total deductions", unit: "eur" },
  fundContribEmployee: { label: "Contributo Cometa dipendente", hint: "Pension fund, employee share", unit: "eur" },
  fundContribEmployer: { label: "Contributo Cometa azienda", hint: "Pension fund, employer share", unit: "eur" },
  ferieBalance: { label: "Ferie residue", hint: "Vacation hours remaining", unit: "hours" },
  rolBalance: { label: "ROL residue", hint: "Permit hours remaining", unit: "hours" },
  permessiBalance: { label: "Permessi residui", hint: "Other permit hours remaining", unit: "hours" },
  ferieTakenHours: { label: "Ferie godute", hint: "Vacation hours taken", unit: "hours" },
  rolTakenHours: { label: "ROL godute", hint: "Permit hours taken", unit: "hours" },
};

/** The statuses a reviewer still has something to do about. */
const AWAITING: readonly PayrollImport["status"][] = ["needs_review", "verified", "needs_ocr"];

function toRow(item: PayrollImport): ImportRow {
  const fields = item.extraction?.fields;
  const net = fields?.net?.value;
  return {
    id: item.id,
    fileName: item.fileName,
    status: item.status,
    scanStatus: item.scanStatus,
    month: item.extraction?.month ?? null,
    net: net === null || net === undefined ? null : net.toFixed(2),
    createdAt: item.createdAt.toISOString(),
    version: item.version,
  };
}

export async function loadImports(): Promise<ImportRow[]> {
  return runForPrincipal(async (deps, principal) => (await listImports(deps)(principal)).map(toRow));
}

export async function loadReview(importId: string): Promise<ReviewData | null> {
  return runForPrincipal(async (deps, principal) => {
    // Only a missing import renders as "not found". Anything else — a database
    // failure, a permission edge, a bug — is a real error and must surface as
    // one, the fix the Expenses and Interests loaders both needed.
    const found = await getImport(deps)(principal, importId).catch((err: unknown) => {
      if (err instanceof NotFoundError) return null;
      throw err;
    });
    if (!found) return null;

    const extraction = found.extraction;
    const fields: ReviewField[] = PAYSLIP_FIELDS.map((name) => {
      const meta = FIELD_META[name];
      const extracted = extraction?.fields[name];
      return {
        name,
        label: meta.label,
        hint: meta.hint,
        unit: meta.unit,
        // An empty string, not "0": a field the parser could not read must
        // arrive at the reviewer blank, so a confirmation is a decision rather
        // than an accident.
        initial: extracted?.value === null || extracted?.value === undefined ? "" : String(extracted.value),
        confidence: extracted?.confidence ?? "low",
        rules: extracted?.rules ?? null,
        llm: extracted?.llm ?? null,
      };
    });

    const queue = await listImports(deps)(principal, { statuses: AWAITING });
    const pending: QueueEntry[] = orderQueue(
      queue.map((item) => ({
        id: item.id,
        month: item.extraction?.month ?? item.createdAt.toISOString().slice(0, 10),
        isThirteenth: item.extraction?.isThirteenth ?? false,
      })),
    );

    return {
      import: toRow(found),
      fields,
      checks: extraction?.checks ?? [],
      pending,
      month: extraction?.month ?? "",
      isThirteenth: extraction?.isThirteenth ?? false,
      version: found.version,
    };
  });
}
