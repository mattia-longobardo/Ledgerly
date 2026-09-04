/** No adapter is registered under that code. */
export class UnknownProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownProviderError";
  }
}

/** No such connection, or it belongs to somebody else — the two are one answer on purpose. */
export class ConnectionNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionNotFoundError";
  }
}

/** The provider's own `credentialSchema` refused what was typed. Mirrors `InvalidInputError`. */
export class CredentialValidationError extends Error {
  constructor(
    message: string,
    readonly issues?: unknown,
  ) {
    super(message);
    this.name = "CredentialValidationError";
  }
}

/**
 * Spec §3.2: a mutation that carried an expected version lost the race.
 * Thrown by `connectIntegration` (Ruling P2-C9) rather than swallowed — a
 * connect that silently dropped the settings it was asked to apply would leave
 * the person looking at a page that disagrees with the database.
 */
export class ConnectionVersionMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionVersionMismatchError";
  }
}

/** The provider implements no handler for that `SyncKind`. */
export class SyncNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncNotSupportedError";
  }
}

/** The connection exists but is not `connected`, so nothing may be synced through it. */
export class ConnectionNotUsableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionNotUsableError";
  }
}

/** The `sync_jobs` row for this (connection, kind) is switched off (Ruling P2-C4). */
export class SyncDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncDisabledError";
  }
}
