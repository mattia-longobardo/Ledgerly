// tests/e2e/totp.ts — the authenticator app of the e2e users (docs/auth-design.md D2).
import { readFileSync } from "node:fs";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { TOTP_FILE } from "./env";

/** The current code for a base32 secret, as the otpauth URI and the setup page show it. */
export function totpCode(secret: string): Promise<string> {
  return createOTP(base32.decode(secret.replace(/\s/g, ""))).totp();
}

/** The secret the seed set up for this address. */
export function totpSecretFor(email: string): string {
  const secrets = JSON.parse(readFileSync(TOTP_FILE, "utf8")) as Record<string, string>;
  const secret = secrets[email];
  if (!secret) throw new Error(`No TOTP secret for ${email}`);
  return secret;
}
