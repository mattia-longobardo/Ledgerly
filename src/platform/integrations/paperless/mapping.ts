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

/**
 * Where a pass starts: the stored cursor, or — on the very first pass — the moment the link was
 * saved. Not a window in the past (the design's 90 days): many payslips already in Ledgerly were
 * uploaded by hand as a different PDF from the one Paperless keeps, so their sha256 differs and a
 * look back would import each of them a second time (found in PERS-47). What was filed before the
 * link is already here; the pull is for what comes after.
 */
export function startCursor(stored: Record<string, string> | null | undefined, linkedAt: Date): string {
  const modified = stored?.modified;
  if (modified && !Number.isNaN(Date.parse(modified))) return modified;
  return linkedAt.toISOString();
}

/** A file name to store: Paperless's own, else its original name, else one made from the id. */
export function storedName(input: { header: string | null; original: string | null; id: number }): string {
  const name = (input.header ?? input.original ?? "").trim();
  return name === "" ? `paperless-${input.id}.pdf` : name.slice(0, 200);
}
