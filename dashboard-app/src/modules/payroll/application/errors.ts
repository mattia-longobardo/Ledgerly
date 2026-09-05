export class NotFoundError extends Error {
  constructor(message = "Payroll import not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class VersionMismatchError extends Error {
  constructor(message = "This import changed since you opened it. Reload and try again.") {
    super(message);
    this.name = "VersionMismatchError";
  }
}

export class InvalidInputError extends Error {
  constructor(
    message: string,
    readonly issues?: unknown,
  ) {
    super(message);
    this.name = "InvalidInputError";
  }
}

/**
 * A duplicate upload (Ruling R4-3). Carries the id of the import that already
 * holds these bytes so the API can answer `409 duplicate` with somewhere for
 * the user to go, which spec §7.9 requires.
 */
export class DuplicateImportError extends Error {
  constructor(readonly existingImportId: string) {
    super("This payslip has already been uploaded.");
    this.name = "DuplicateImportError";
  }
}

/**
 * A transition the pipeline refuses: applying an unverified import, re-verifying
 * an applied one, reading an original that has not cleared the scanner
 * (Ruling R4-2), or reading one the retention job has purged (Ruling R4-5).
 * Always a `409 conflict`, never a 404 — the thing exists, the action does not
 * apply to it.
 */
export class ConflictError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "ConflictError";
  }
}
