import type { PluginErrorCode } from "@ledgerly/plugin-contract";

/** A failure of the whole call, with a code of the contract. The source's own words never leave the plugin. */
export class PluginFailure extends Error {
  constructor(readonly code: PluginErrorCode) {
    super(code);
    this.name = "PluginFailure";
  }
}
