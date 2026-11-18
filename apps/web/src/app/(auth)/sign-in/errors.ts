export type SignInErrorKey =
  "credentials" | "invitationRequired" | "oidc" | "accountNotLinked" | "banned" | "generic";

/** Better Auth codes with a message of their own; any other code is "generic". */
const KNOWN_CODES = new Map<string, SignInErrorKey>([
  ["INVALID_EMAIL_OR_PASSWORD", "credentials"],
  ["invitation_required", "invitationRequired"],
  // The admin plugin refuses to open a session for a banned user, by password or through Authentik.
  ["BANNED_USER", "banned"],
]);

/** Reasons Better Auth gives for refusing an Authentik sign-in that the user can act on. */
const OIDC_REASONS = new Map<string, SignInErrorKey>([
  // Implicit linking is off (auth.ts): the address already belongs to a user without this identity.
  ["account_not_linked", "accountNotLinked"],
  ["BANNED_USER", "banned"],
]);

/**
 * The `error` query parameter can repeat: Better Auth appends its own `error` to the error callback
 * URL (`?error=oidc&error=<code>`), so ours is the first value and Better Auth's reason the second.
 */
export function signInErrorKey(code: string | string[] | undefined): SignInErrorKey | null {
  const [first, reason] = Array.isArray(code) ? code : [code];
  if (!first) return null;
  if (first === "oidc") return (reason && OIDC_REASONS.get(reason)) || "oidc";
  return KNOWN_CODES.get(first) ?? "generic";
}
