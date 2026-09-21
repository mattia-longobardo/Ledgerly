import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Personal access tokens (spec §5.3), as pure rules: the format, the hash, the state and the
 * scopes. Nothing here touches the database, so the whole shape of a token is unit-testable.
 */

export const TOKEN_SCOPES = ["read", "write", "imports"] as const;
export type Scope = (typeof TOKEN_SCOPES)[number];

/** `pat_<prefix>.<secret>` (spec §5.3): the prefix may be shown, the secret never again. */
const TOKEN = /^pat_([a-z0-9]{8})\.([A-Za-z0-9_-]{43})$/;

const PREFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const PREFIX_LENGTH = 8;
const SECRET_BYTES = 32;

/**
 * The public half of a token: eight characters a person can match against the row in front of
 * them. Not a secret and not a key, so the modulo bias of mapping a byte onto 36 letters is of no
 * consequence — collisions are caught by the unique index, which is what makes it an identifier.
 */
function newPrefix(): string {
  const bytes = randomBytes(PREFIX_LENGTH);
  let prefix = "";
  for (const byte of bytes) prefix += PREFIX_ALPHABET[byte % PREFIX_ALPHABET.length];
  return prefix;
}

/**
 * sha256, not argon2: the secret is 32 random bytes, not a password a person chose. There is no
 * dictionary to start from, and the check runs on every call of `/api/v1`, so it must be cheap
 * (plan F8 §3.2).
 */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** A new token: the value to show once, and the two columns that are kept. */
export function mintToken(): { token: string; prefix: string; hash: string } {
  const prefix = newPrefix();
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  return { token: `pat_${prefix}.${secret}`, prefix, hash: hashSecret(secret) };
}

/** The two halves of a token someone sent us, or null when it is not one of ours at all. */
export function parseToken(value: string): { prefix: string; hash: string } | null {
  const match = TOKEN.exec(value.trim());
  return match ? { prefix: match[1], hash: hashSecret(match[2]) } : null;
}

/** Compares two hex digests without telling an attacker how far they got. */
export function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export type TokenState = "active" | "expired" | "revoked";

/** Revoked beats expired: a token taken back was taken back, whatever its end date said. */
export function tokenState(
  row: { expiresAt: Date | null; revokedAt: Date | null },
  now: Date = new Date(),
): TokenState {
  if (row.revokedAt) return "revoked";
  return row.expiresAt && row.expiresAt <= now ? "expired" : "active";
}

/** Whether a token carries the scope a route asks for. A second gate, never the first (spec §5.2). */
export function allows(scopes: readonly string[], needed: Scope): boolean {
  return scopes.includes(needed);
}

/** The scopes a person ticked, validated: a non-empty subset of {@link TOKEN_SCOPES}. */
export function parseScopes(input: readonly string[]): Scope[] | null {
  const scopes = TOKEN_SCOPES.filter((scope) => input.includes(scope));
  return scopes.length > 0 && scopes.length === new Set(input).size ? scopes : null;
}

export const MAX_TOKEN_NAME = 60;

/** `last_used_at` moves at most once a minute, so a call a second is not a write a second (§5.3). */
export const TOUCH_INTERVAL_MS = 60_000;

/** The expiry choices the card offers (spec §5.3: optional), as days; null is "no end date". */
export const EXPIRY_CHOICES = [30, 90, 365, null] as const;
export type ExpiryChoice = (typeof EXPIRY_CHOICES)[number];

export function expiryFrom(days: ExpiryChoice, now: Date = new Date()): Date | null {
  return days === null ? null : new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}
