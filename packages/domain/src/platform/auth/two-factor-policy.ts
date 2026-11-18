/** `TWO_FACTOR_POLICY` (docs/auth-design.md D2): whether a password account must have TOTP. */
export type TwoFactorPolicy = "required" | "optional";

export const TWO_FACTOR_SETUP_PATH = "/sign-in/two-factor/setup";
export const TWO_FACTOR_CHALLENGE_PATH = "/sign-in/two-factor";

/**
 * Whether a signed-in person has to set up TOTP before the app opens. Only a password account
 * can be asked: an Authentik-only user has their second factor in Authentik, and Better Auth never
 * challenges an SSO callback. A person with both a password and Authentik is asked too, because the
 * password door is open whichever way they came in this time.
 */
export function twoFactorSetupRequired(input: {
  policy: TwoFactorPolicy;
  twoFactorEnabled: boolean;
  hasPassword: boolean;
}): boolean {
  return input.policy === "required" && !input.twoFactorEnabled && input.hasPassword;
}
