export type SignInErrorKey = "credentials" | "invitationRequired" | "oidc" | "generic";

/**
 * The `error` query parameter can repeat: Better Auth appends its own `error` to the error callback
 * URL (`?error=oidc&error=<code>`), so ours is the first value.
 */
export function signInErrorKey(code: string | string[] | undefined): SignInErrorKey | null {
  const first = Array.isArray(code) ? code[0] : code;
  if (!first) return null;
  if (first === "oidc") return "oidc";
  if (first === "invitation_required") return "invitationRequired";
  if (first === "INVALID_EMAIL_OR_PASSWORD") return "credentials";
  return "generic";
}
