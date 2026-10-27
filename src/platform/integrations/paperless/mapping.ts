/**
 * Which Paperless document types Ledgerly reads, and as what (docs/auth-design.md D5). The
 * connection stores type **names** — "Payroll", as a person sees them in Paperless — and each pass
 * resolves them to ids, so renumbering in Paperless never needs a new connection.
 */
import type { DocumentKind } from "@/modules/imports/rules";
import type { PaperlessDocumentType } from "./client";

/** The credential keys of a Paperless connection that name a type, one per kind it can read. */
export const TYPE_KEYS = {
  payslip: "payslipType",
  cometa_operations: "cometaOperationsType",
  cometa_position: "cometaPositionType",
} as const satisfies Record<DocumentKind, string>;

export const DEFAULT_PAYSLIP_TYPE = "Payroll";

/** The first pass reads back this far (design §3 step 2): old payslips come back as duplicates. */
export const INITIAL_LOOKBACK_DAYS = 90;

/** At most this many documents per pass: a first pass over a big archive finishes on the next. */
export const MAX_DOCUMENTS_PER_PASS = 200;

/**
 * The configured names resolved against what Paperless has, case-insensitively. A name Paperless
 * does not know is reported, never guessed: reading the wrong type would import the wrong files.
 */
export function resolveTypes(
  credentials: Record<string, string>,
  types: readonly PaperlessDocumentType[],
): { byType: Map<number, DocumentKind>; missing: string[] } {
  const byName = new Map(types.map((type) => [type.name.trim().toLowerCase(), type.id]));
  const byType = new Map<number, DocumentKind>();
  const missing: string[] = [];
  for (const [kind, key] of Object.entries(TYPE_KEYS) as [DocumentKind, string][]) {
    const name = credentials[key]?.trim();
    if (!name) continue;
    const id = byName.get(name.toLowerCase());
    if (id === undefined) missing.push(name);
    else if (!byType.has(id)) byType.set(id, kind);
  }
  return { byType, missing };
}

/** Where a pass starts: the stored cursor, or the lookback window on the very first pass. */
export function startCursor(stored: Record<string, string> | null | undefined, now: Date): string {
  const modified = stored?.modified;
  if (modified && !Number.isNaN(Date.parse(modified))) return modified;
  return new Date(now.getTime() - INITIAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** A file name to store: Paperless's own, else its original name, else one made from the id. */
export function storedName(input: { header: string | null; original: string | null; id: number }): string {
  const name = (input.header ?? input.original ?? "").trim();
  return name === "" ? `paperless-${input.id}.pdf` : name.slice(0, 200);
}
