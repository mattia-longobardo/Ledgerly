import type { PluginErrorCode } from "@ledgerly/plugin-contract";

/**
 * A failure with a code of the contract. The message is the code: the provider's own words never
 * leave the function that read them.
 */
export class PluginFailure extends Error {
  constructor(
    readonly code: PluginErrorCode,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = "PluginFailure";
  }
}

/**
 * Why a Wallet call failed. `token_rejected` is the one the core has to tell apart: a credential
 * Wallet refuses will keep being refused, so it is never retried.
 */
type WalletErrorKind = "token_rejected" | "http" | "network" | "timeout" | "payload" | "page_truncated";

interface WalletErrorExtra {
  status?: number;
  retryable?: boolean;
  /** What Wallet itself asked for: `Retry-After`, or the floor of a Wallet still initialising. */
  minDelayMs?: number | null;
}

/**
 * Every failure of a Wallet call. Its message stays inside the plugin (the server logs the name
 * only and answers with a code), so it may say what went wrong — never the token.
 */
export class WalletError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  readonly minDelayMs: number | null;

  constructor(
    readonly kind: WalletErrorKind,
    message: string,
    extra: WalletErrorExtra = {},
  ) {
    super(message);
    this.name = "WalletError";
    this.status = extra.status ?? null;
    this.retryable = extra.retryable ?? false;
    this.minDelayMs = extra.minDelayMs ?? null;
  }
}

const MAX_RETRY_AFTER_SECONDS = 604_800;

function codeOf(error: WalletError): PluginErrorCode {
  if (error.kind === "token_rejected") return "auth";
  if (error.kind === "network" || error.kind === "timeout") return "provider_down";
  if (error.kind === "payload" || error.kind === "page_truncated") return "invalid_data";
  if (error.status === 429) return "rate_limited";
  // A 5xx, or a 409 while Wallet initialises: its failure, not the request's.
  return error.retryable ? "provider_down" : "failed";
}

/** A Wallet failure in the contract's words, with the wait Wallet asked for when it named one. */
export function failureOf(error: WalletError): PluginFailure {
  const seconds =
    error.minDelayMs === null
      ? undefined
      : Math.min(MAX_RETRY_AFTER_SECONDS, Math.ceil(error.minDelayMs / 1000));
  return new PluginFailure(codeOf(error), seconds);
}
