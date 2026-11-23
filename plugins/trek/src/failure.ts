import type { PluginErrorCode } from "@ledgerly/plugin-contract";
import { TrekError } from "./errors";

/**
 * A failure with a code of the contract. The message is the code: Trek's own words never leave the
 * function that read them.
 */
export class PluginFailure extends Error {
  constructor(readonly code: PluginErrorCode) {
    super(code);
    this.name = "PluginFailure";
  }
}

/**
 * A Trek failure in the contract's words. A refused credential is `auth`: it will keep being
 * refused, so the core marks the connection and stops asking.
 */
function failureOf(error: TrekError): PluginFailure {
  if (error.kind === "token_rejected" || error.kind === "client_rejected") return new PluginFailure("auth");
  if (error.kind === "network" || error.kind === "timeout") return new PluginFailure("provider_down");
  if (error.kind === "payload") return new PluginFailure("invalid_data");
  if (error.status === 429) return new PluginFailure("rate_limited");
  return new PluginFailure(error.retryable ? "provider_down" : "failed");
}

export function asFailure(error: unknown): PluginFailure | null {
  if (error instanceof PluginFailure) return error;
  return error instanceof TrekError ? failureOf(error) : null;
}
