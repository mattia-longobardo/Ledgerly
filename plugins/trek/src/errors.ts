/**
 * Why a Trek call failed. The message stays inside the plugin (the server logs the name only and
 * answers with a code of the contract), so it may say what went wrong — never the secret.
 */
const MAX_DETAIL_CHARS = 4_000;

type TrekErrorKind =
  /** The bearer token was refused by `/mcp`: expired or revoked, decided before any tool ran. */
  | "token_rejected"
  /** The machine client itself was refused by the token endpoint: no token was ever issued. */
  | "client_rejected"
  /** The session id was refused: likewise decided before any tool ran. */
  | "session_rejected"
  /** The tool answered, and said no — a weekend, say. A domain refusal, not a fault. */
  | "refused"
  | "http"
  | "network"
  | "timeout"
  | "payload";

interface TrekErrorExtra {
  status?: number | null;
  detail?: unknown;
  retryable?: boolean;
}

/** Every failure of the Trek client. The secret never appears in a message or a detail. */
export class TrekError extends Error {
  readonly status: number | null;
  readonly detail: unknown;
  readonly retryable: boolean;

  constructor(
    readonly kind: TrekErrorKind,
    message: string,
    extra: TrekErrorExtra = {},
  ) {
    super(message);
    this.name = "TrekError";
    this.status = extra.status ?? null;
    this.detail = extra.detail ?? null;
    this.retryable = extra.retryable ?? false;
  }
}

/**
 * Whether the credential is the problem, in either of its two senses: the machine client was
 * refused, or the token it minted was. Neither comes right by waiting.
 */
export function isTokenRejected(error: unknown): boolean {
  return error instanceof TrekError && (error.kind === "token_rejected" || error.kind === "client_rejected");
}

/** Trek refuses a weekend. A domain outcome the caller reports, not a failure it retries. */
export function isWeekendRefusal(error: unknown): boolean {
  if (!(error instanceof TrekError) || error.kind !== "refused") return false;
  return JSON.stringify(error.detail ?? error.message)
    .toLowerCase()
    .includes("weekend");
}

/**
 * A write refused for its scope: `/mcp` answers 403 to a token that may read and not write
 * (RFC 6750 `insufficient_scope`), before the tool runs, so nothing landed.
 */
export function isScopeRefusal(error: unknown): boolean {
  return error instanceof TrekError && error.kind === "token_rejected" && error.status === 403;
}

/** 401/403 refuse the token; 404 (and a 400 naming a session) refuse the session id. */
export function isPreDispatchRefusal(error: unknown): boolean {
  return error instanceof TrekError && (error.kind === "token_rejected" || error.kind === "session_rejected");
}

/**
 * A refusal from the token endpoint. `invalid_client`, `unauthorized_client`, `invalid_scope` and
 * `invalid_grant` are facts about the machine client — wrong secret, or one never allowed this
 * grant — so they land as `client_rejected` rather than being retried for ever.
 */
export function tokenError(status: number, body: string): TrekError {
  const detail = body.slice(0, MAX_DETAIL_CHARS);
  const code = /invalid_client|unauthorized_client|invalid_scope|invalid_grant/.exec(detail)?.[0];
  if (status === 400 || status === 401 || status === 403) {
    return new TrekError(
      "client_rejected",
      `Trek refused the machine client (HTTP ${status}${code ? `, ${code}` : ""}). Check the client ` +
        `id and secret, and that the client is a machine client with the vacay:read and ` +
        `vacay:write scopes (Trek → Settings → Integrations → MCP → OAuth 2.1 Clients)`,
      { status, detail },
    );
  }
  return new TrekError("http", `Trek's token endpoint answered HTTP ${status}`, {
    status,
    detail,
    retryable: status === 429 || status >= 500,
  });
}

export function httpError(status: number, body: string): TrekError {
  const detail = body.slice(0, MAX_DETAIL_CHARS);
  if (status === 401 || status === 403) {
    return new TrekError("token_rejected", `Trek rejected the MCP token (HTTP ${status})`, {
      status,
      detail,
    });
  }
  // The MCP spec prescribes 404 for an expired session; some servers answer 400 and say so in the
  // body. Both are decided before the tool runs, so no write can have landed.
  if (status === 404 || (status === 400 && detail.toLowerCase().includes("session"))) {
    return new TrekError("session_rejected", `Trek refused the MCP session (HTTP ${status})`, {
      status,
      detail,
    });
  }
  return new TrekError("http", `Trek answered HTTP ${status}`, {
    status,
    detail,
    retryable: status === 408 || status === 429 || status >= 500,
  });
}

/** A transport failure: the request never got an answer, so trying again cannot cost a day. */
export function transportError(aborted: boolean, what: string, cause: unknown): TrekError {
  return new TrekError(
    aborted ? "timeout" : "network",
    aborted
      ? `Trek did not answer ${what} in time`
      : `Trek could not be reached for ${what}: ${errorText(cause)}`,
    { retryable: true },
  );
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
