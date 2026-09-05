import { PAYSLIP_FIELDS, type Confidence, type PayslipField, type SanityCheck } from "@/lib/contracts";
import { NotFoundError } from "../application/errors";
import { getImport, listImports } from "../application/list-imports";
import type { PayrollImport } from "../application/ports";
import type { QueueEntry } from "./queue";
import { AWAITING_STATUSES, orderQueue, queueEntryFrom } from "./queue";
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
 * The English labels and Italian hints the review screen shows beside each
 * field — the shape the retired `/work/verify/[id]` page used (label: "Net",
 * hint: "NETTO BUSTA"), restored here (Finding 5, whole-branch review) after
 * this loader had inverted it: a label is UI copy and must be English (Global
 * Constraint), while the hint carries the payslip's own wording so a reviewer
 * can still cross-check the figure against the document in front of them.
 */
const FIELD_META: Record<PayslipField, { label: string; hint: string; unit: "eur" | "hours" }> = {
  gross: { label: "Gross", hint: "TOTALE LORDO", unit: "eur" },
  net: { label: "Net", hint: "NETTO BUSTA", unit: "eur" },
  taxes: { label: "Taxes", hint: "TOTALE TRATTENUTE", unit: "eur" },
  fundContribEmployee: { label: "Pension fund, employee share", hint: "FONDO C/DIPE (Cometa)", unit: "eur" },
  fundContribEmployer: { label: "Pension fund, employer share", hint: "FONDO C/AZIENDA (Cometa)", unit: "eur" },
  ferieBalance: { label: "Vacation balance", hint: "FERIE RESIDUE, in hours", unit: "hours" },
  rolBalance: { label: "Permit balance (ROL)", hint: "ROL RESIDUI, in hours", unit: "hours" },
  permessiBalance: { label: "Other permit balance", hint: "PERMESSI RESIDUI, in hours", unit: "hours" },
  ferieTakenHours: { label: "Vacation taken", hint: "FERIE GODUTE, hours used", unit: "hours" },
  rolTakenHours: { label: "Permit taken (ROL)", hint: "ROL GODUTE, hours used", unit: "hours" },
};

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

    const queue = await listImports(deps)(principal, { statuses: AWAITING_STATUSES });
    const pending: QueueEntry[] = orderQueue(queue.map(queueEntryFrom));

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
