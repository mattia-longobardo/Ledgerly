/**
 * An account the caller may not see — either it does not exist, or it belongs
 * to somebody else. Both cases raise this, deliberately: telling one from the
 * other would leak the existence of another user's account.
 */
export class NotFoundError extends Error {
  constructor(message = "Account not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** The account moved on since the caller read it; the edit has to be retried. */
export class VersionMismatchError extends Error {
  constructor(message = "The account changed since you opened it. Reload and try again.") {
    super(message);
    this.name = "VersionMismatchError";
  }
}

/** A synced account still live at the provider cannot be removed from here. */
export class DeletionBlockedError extends Error {
  readonly reason = "linked";

  constructor(message = "Unlink this account from its provider before deleting it.") {
    super(message);
    this.name = "DeletionBlockedError";
  }
}

/** Input the domain refuses, whether Zod caught it or a rule did. */
export class InvalidInputError extends Error {
  constructor(
    message: string,
    readonly issues?: unknown,
  ) {
    super(message);
    this.name = "InvalidInputError";
  }
}
