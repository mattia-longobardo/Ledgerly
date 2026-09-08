import type { Principal } from "@/platform/auth/principal";
import { NotFoundError } from "./errors";
import type { UseCaseDeps } from "./ports";

/**
 * Kill one of the caller's own tokens.
 *
 * The row is kept and stamped rather than deleted: the owner should still see
 * that the credential existed and when it stopped working, and
 * `authenticateToken` refuses any row with `revoked_at` set. A revocation
 * that matched nothing — a wrong id, someone else's token, or one already
 * revoked — is a `NotFoundError`, never a silent success.
 */
export function revokeToken(deps: UseCaseDeps) {
  return async (principal: Principal, id: string): Promise<void> => {
    const revoked = await deps.tokens.revoke(principal.userId, id, deps.clock.now());
    if (!revoked) throw new NotFoundError();
    await deps.audit({
      actorUserId: principal.userId,
      action: "security.token_revoked",
      entityType: "personal_access_token",
      entityId: revoked.id,
      after: { name: revoked.name, prefix: revoked.prefix },
    });
  };
}
