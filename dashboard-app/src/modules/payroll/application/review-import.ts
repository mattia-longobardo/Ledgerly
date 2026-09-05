import { PAYSLIP_FIELDS, type PayslipExtraction, type PayslipField } from "@/lib/contracts";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { isEditable } from "../domain/payroll";
import { periodFor } from "../domain/period";
import type { PayrollImport, UseCaseDeps } from "./ports";
import { ConflictError, InvalidInputError, NotFoundError, VersionMismatchError } from "./errors";

/**
 * Signed decimals only. Italian formatting (`1.800,00`) is rejected at the
 * door, not silently reinterpreted.
 *
 * The integer part is capped at 14 digits to match `payroll_records.gross`/
 * `.net` — `numeric(16, 2)`, so 16 significant digits total minus the 2 the
 * scale reserves leaves 14 for the integer part (Finding 7, B2 whole-branch
 * review). Uncapped, a very long numeric string would pass this check, get
 * converted through `Number(raw)` below (a documented, deliberate float
 * crossing for a reviewer-typed value that is always small in practice), and
 * only then get silently truncated to the column's precision — this bound
 * makes that case a rejected `422`, not a silent precision loss.
 */
const DECIMAL_RE = /^-?\d{1,14}(\.\d{1,6})?$/;

export interface VerifyImportInput {
  version: number;
  /** The pay period's month key, `YYYY-MM-01`. */
  month: string;
  isThirteenth: boolean;
  /** Only the fields the reviewer actually touched; `null` clears one. */
  values: Partial<Record<PayslipField, string | null>>;
}

function assertReviewable(
  found: PayrollImport | null,
): asserts found is PayrollImport & { extraction: PayslipExtraction } {
  if (!found) throw new NotFoundError();
  if (found.status === "applied") {
    throw new ConflictError(
      "This payslip has already been applied. Upload a corrected file to replace it.",
      "already_applied",
    );
  }
  if (!isEditable(found.status) || found.extraction === null) {
    throw new ConflictError("This import is not ready to review.", "not_reviewable");
  }
}

/**
 * The human gate.
 *
 * Confirmed values are written back into the import's own `extraction`, and
 * the value the parser produced is preserved as `rules`/`llm` on the same
 * field — so `corrections` (extracted vs corrected) is derivable, and
 * `applyImport` has exactly one thing to read. A reviewer's confirmation
 * always raises that field's confidence to `high`: a human looked at the
 * document, which is the strongest signal this system has.
 *
 * Ruling R4-6: values stay editable while `needs_review` or `verified`, and
 * stop being editable once `applied`. Re-verifying an applied import is a
 * `409` naming the replacement path, never a silent overwrite of figures that
 * have already reached Earnings and the Funds page.
 */
export function verifyImport(deps: UseCaseDeps) {
  return async (principal: Principal, importId: string, input: VerifyImportInput): Promise<PayrollImport> => {
    assertPermission(principal, "payroll.review");
    const found = await deps.imports.get(principal.userId, importId);
    assertReviewable(found);
    if (found.version !== input.version) throw new VersionMismatchError();

    // `periodFor` throws a plain `Error` on a month that is not a real
    // calendar month; wrapped here as `InvalidInputError` so the API layer
    // answers 400, not 500, and so an impossible period never reaches
    // `payroll_records`.
    try {
      periodFor(input.month);
    } catch {
      throw new InvalidInputError(`"${input.month}" is not a valid month. Use the form YYYY-MM-01.`);
    }

    for (const [field, raw] of Object.entries(input.values)) {
      if (raw === null || raw === undefined) continue;
      if (!DECIMAL_RE.test(raw)) {
        throw new InvalidInputError(`Enter ${field} as a plain decimal, for example 1800.50.`);
      }
      if (!(PAYSLIP_FIELDS as readonly string[]).includes(field)) {
        throw new InvalidInputError(`Unknown payslip field: ${field}`);
      }
    }

    const fields: PayslipExtraction["fields"] = { ...found.extraction.fields };
    const confidence: Record<string, "high" | "medium" | "low"> = { ...(found.confidence ?? {}) };
    const corrections: Record<string, { extracted: unknown; corrected: unknown }> = {};

    for (const [key, raw] of Object.entries(input.values)) {
      const field = key as PayslipField;
      const previous = fields[field] ?? { value: null, confidence: "low" as const, rules: null, llm: null };
      // A second, named place `number` crosses into this module (see
      // `componentsFromExtraction`'s doc-comment for the first, and Finding
      // 7, B2 whole-branch review). Safe here for the same reason as there:
      // `DECIMAL_RE` above has already accepted `raw` as a bounded decimal
      // string (14 integer digits max, matching `numeric(16, 2)`), so this
      // conversion cannot silently lose precision — it can only fail loudly,
      // and `DECIMAL_RE` is what makes that true rather than `Number` itself.
      const corrected = raw === null || raw === undefined ? null : Number(raw);
      if (previous.value !== corrected) {
        corrections[field] = { extracted: previous.value, corrected };
      }
      fields[field] = {
        value: corrected,
        confidence: "high",
        rules: previous.rules,
        llm: previous.llm,
        note: "confirmed by reviewer",
      };
      confidence[field] = "high";
    }

    const updated = await deps.imports.patch(principal.userId, importId, {
      status: "verified",
      extraction: { ...found.extraction, month: input.month, isThirteenth: input.isThirteenth, fields },
      confidence,
      error: null,
    });
    if (!updated) throw new NotFoundError();
    await deps.audit({
      actorUserId: principal.userId,
      action: "payroll.import_verified",
      entityType: "payroll_import",
      entityId: importId,
      // Field *names* only. The corrected amounts are payroll data and stay out
      // of the audit trail (global constraint).
      after: { month: input.month, isThirteenth: input.isThirteenth, correctedFields: Object.keys(corrections) },
    });
    return updated;
  };
}

/** Terminal. A rejected import keeps its bytes until the retention job purges them (Ruling R4-5). */
export function rejectImport(deps: UseCaseDeps) {
  return async (principal: Principal, importId: string, version: number): Promise<PayrollImport> => {
    assertPermission(principal, "payroll.review");
    const found = await deps.imports.get(principal.userId, importId);
    if (!found) throw new NotFoundError();
    if (found.status === "applied" || found.status === "rejected" || found.status === "superseded") {
      throw new ConflictError("This import can no longer be rejected.", "terminal");
    }
    if (found.version !== version) throw new VersionMismatchError();
    const updated = await deps.imports.patch(principal.userId, importId, { status: "rejected", error: null });
    if (!updated) throw new NotFoundError();
    await deps.audit({
      actorUserId: principal.userId,
      action: "payroll.import_rejected",
      entityType: "payroll_import",
      entityId: importId,
      after: { reason: "rejected_by_reviewer" },
    });
    return updated;
  };
}
