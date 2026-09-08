import type { Principal } from "@/platform/auth/principal";
import type { TokenRecord, UseCaseDeps } from "./ports";

/**
 * The caller's own tokens, newest first. Revoked and expired rows stay in the
 * list — the owner needs to see that a credential they issued is dead, and
 * hiding it would look like it had been deleted.
 *
 * `TokenRecord` carries no hash, so there is nothing here to redact.
 */
export function listTokens(deps: UseCaseDeps) {
  return async (principal: Principal): Promise<TokenRecord[]> => deps.tokens.list(principal.userId);
}
