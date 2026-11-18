// Client-safe helpers for the TOTP screens (docs/auth-design.md D2). No `server-only`: the setup
// and challenge forms run in the browser.

/** Message keys under `auth.twoFactor.errors`. */
export type TwoFactorErrorKey =
  | "invalidCode"
  | "invalidBackupCode"
  | "tooManyAttempts"
  | "locked"
  | "expired"
  | "password"
  | "rateLimited"
  | "generic";

const CODES = new Map<string, TwoFactorErrorKey>([
  ["INVALID_CODE", "invalidCode"],
  ["INVALID_BACKUP_CODE", "invalidBackupCode"],
  // Five wrong codes end the challenge: the person signs in with the password again.
  ["TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE", "tooManyAttempts"],
  // Ten wrong codes in a row lock the account's second factor for 15 minutes.
  ["ACCOUNT_TEMPORARILY_LOCKED", "locked"],
  // The challenge cookie lasts 10 minutes and is single-use.
  ["INVALID_TWO_FACTOR_COOKIE", "expired"],
  ["INVALID_PASSWORD", "password"],
]);

/** The message for a Better Auth error answer on a two-factor endpoint. */
export function twoFactorErrorKey(
  error: { code?: string; status?: number } | null | undefined,
): TwoFactorErrorKey {
  if (!error) return "generic";
  const known = error.code ? CODES.get(error.code) : undefined;
  if (known) return known;
  return error.status === 429 ? "rateLimited" : "generic";
}

/** The base32 secret inside an `otpauth://totp/…?secret=…` URI, for typing it in by hand. */
export function totpSecretOf(uri: string): string | null {
  if (!URL.canParse(uri)) return null;
  const secret = new URL(uri).searchParams.get("secret");
  return secret ? secret.replace(/(.{4})(?=.)/g, "$1 ") : null;
}

/** A TOTP code as typed: spaces and dashes out, six digits or nothing. */
export function normalizeTotp(input: string): string {
  return input.replace(/[\s-]/g, "");
}

/** The text file "Download" saves: one code per line under a heading that says what they are. */
export function recoveryCodesFile(codes: readonly string[], account: string): string {
  return [`Ledgerly recovery codes — ${account}`, "Each code works once.", "", ...codes, ""].join("\n");
}
