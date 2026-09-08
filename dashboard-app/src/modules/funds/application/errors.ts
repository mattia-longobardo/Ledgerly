export class NotFoundError extends Error {
  constructor(message = "Fund not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class VersionMismatchError extends Error {
  constructor(message = "This fund changed since you opened it. Reload and try again.") {
    super(message);
    this.name = "VersionMismatchError";
  }
}

export class InvalidInputError extends Error {
  constructor(message: string, readonly issues?: unknown) {
    super(message);
    this.name = "InvalidInputError";
  }
}
