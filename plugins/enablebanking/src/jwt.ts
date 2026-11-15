/**
 * The token every call to the provider carries: a JWT signed RS256 with the private key of the
 * person's application (`kid` = the application id). The key arrives in the body of a call from
 * the core and lives only for that call: nothing here keeps it.
 */
import { createPrivateKey, createSign, type KeyObject } from "node:crypto";

const ISSUER = "enablebanking.com";
const AUDIENCE = "api.enablebanking.com";
/** Far below the provider's limit of 24 hours: a token serves one call of the core. */
const LIFETIME_SECONDS = 300;

/** The private key of a PEM file, or `null` when the text is not an RSA private key. */
export function parsePrivateKey(pem: string): KeyObject | null {
  try {
    const key = createPrivateKey(pem);
    return key.asymmetricKeyType === "rsa" ? key : null;
  } catch {
    return null;
  }
}

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function signToken(applicationId: string, key: KeyObject, now: Date = new Date()): string {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = base64url({ typ: "JWT", alg: "RS256", kid: applicationId });
  const payload = base64url({ iss: ISSUER, aud: AUDIENCE, iat: issuedAt, exp: issuedAt + LIFETIME_SECONDS });
  const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(key).toString("base64url");
  return `${header}.${payload}.${signature}`;
}
