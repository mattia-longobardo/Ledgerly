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
