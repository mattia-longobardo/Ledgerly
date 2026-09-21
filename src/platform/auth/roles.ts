import { decodeJwt } from "jose";
import type { Role } from "@/platform/context";

/**
 * Admin when the ID token's `groups` claim contains the configured admin group.
 * Returns null otherwise: an SSO login can promote, never demote (demotion is an admin action).
 * The token was already verified by Better Auth against the provider's JWKS.
 */
export function roleFromIdToken(idToken: string, adminGroup: string): Role | null {
  const { groups } = decodeJwt(idToken);
  return Array.isArray(groups) && groups.includes(adminGroup) ? "admin" : null;
}
