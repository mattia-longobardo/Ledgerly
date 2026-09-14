export type SignInErrorKey = "credentials" | "invitationRequired" | "oidc" | "generic";

export function signInErrorKey(code: string | undefined): SignInErrorKey | null {
  if (!code) return null;
  if (code === "oidc") return "oidc";
  if (code === "invitation_required") return "invitationRequired";
  if (code === "INVALID_EMAIL_OR_PASSWORD") return "credentials";
  return "generic";
}
