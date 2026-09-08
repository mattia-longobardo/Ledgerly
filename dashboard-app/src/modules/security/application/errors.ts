export class NotFoundError extends Error {
  constructor(message = "Token not found") {
    super(message);
    this.name = "NotFoundError";
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
