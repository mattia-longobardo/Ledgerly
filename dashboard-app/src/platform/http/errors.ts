export type ErrorCode =
  | "validation_failed"
  | "unauthorized"
  | "permission_denied"
  | "csrf_required"
  | "not_found"
  | "conflict"
  | "version_mismatch"
  | "precondition_required"
  | "idempotency_key_reused"
  | "rate_limited"
  | "integration_unavailable"
  | "internal";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string; requestId: string; details?: unknown };
}

export function toErrorBody(err: ApiError, requestId: string): ErrorBody {
  return {
    error: {
      code: err.code,
      message: err.message,
      requestId,
      ...(err.details !== undefined ? { details: err.details } : {}),
    },
  };
}
