/**
 * Personal access tokens — the credential primitive (Ruling R8-5).
 *
 * A token is `pat_<8 char base62 prefix>.<43 char base64url secret>`. The
 * database keeps the prefix (so a row is recognisable in a list) and the
 * sha256 of the *whole* token; the plain token exists only in the response
 * that created it. Nothing here logs, audits or returns a token it was given.
 *
 * Scopes are a subset of the owner's permissions at creation and are
 * re-intersected with their **current** permissions at every use, so a role
 * downgrade shrinks live tokens instead of leaving them oversized.
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { personalAccessTokens } from "@/lib/db/schema";
import { withSystemContext } from "@/platform/db/context";
import type { Permission } from "./permissions";
import { resolvePrincipalByUserId, type Principal } from "./principal";

const PREFIX_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const PREFIX_LENGTH = 8;
/** 32 random bytes are exactly 43 base64url characters, unpadded. */
const SECRET_BYTES = 32;

/** The one shape the whole system accepts, used by both the generator and the parser. */
export const TOKEN_PATTERN = /^pat_[0-9A-Za-z]{8}\.[A-Za-z0-9_-]{43}$/;

/** R8-5: `last_used_at` is written at most once a minute per token. */
export const LAST_USED_THROTTLE_MS = 60_000;

export interface GeneratedToken {
  /** The plain token. Shown to its owner once, never stored, never logged. */
  token: string;
  prefix: string;
  /** sha256 of the full token, hex. This is what the row keeps. */
  hash: string;
}

export function generateToken(): GeneratedToken {
  // `randomInt` rejects out-of-range draws internally, so the alphabet stays
  // uniform; `randomBytes(n) % 62` would quietly favour the first four
  // characters.
  let prefix = "";
  for (let i = 0; i < PREFIX_LENGTH; i += 1) prefix += PREFIX_ALPHABET[randomInt(PREFIX_ALPHABET.length)];
  const token = `pat_${prefix}.${randomBytes(SECRET_BYTES).toString("base64url")}`;
  return { token, prefix, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * `Authorization: Bearer pat_….…` → the token, anything else → null.
 *
 * The scheme is matched case-insensitively (RFC 7235 says it is), and the
 * token itself must match `TOKEN_PATTERN`: a Bearer credential of some other
 * shape is not ours and must not reach a database lookup.
 */
export function parseToken(header: string | null | undefined): string | null {
  if (typeof header !== "string") return null;
  const match = /^bearer[ \t]+(\S+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1]!;
  return TOKEN_PATTERN.test(token) ? token : null;
}

/** Constant-time hash comparison, so a lookup cannot be turned into an oracle. */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * R8-5's live intersection: the permissions a token grants are the ones its
 * owner still holds *and* the ones the token was scoped to. Pure, so the rule
 * is testable without a database.
 */
export function intersectScopes(
  permissions: ReadonlySet<Permission>,
  scopes: readonly string[],
): ReadonlySet<Permission> {
  const scoped = new Set(scopes);
  return new Set([...permissions].filter((p) => scoped.has(p)));
}

export interface TokenAuthentication {
  principal: Principal;
  tokenId: string;
}

/**
 * Authenticate a Bearer token: the row must exist, not be revoked, not be
 * expired, and belong to an active user.
 *
 * The lookup runs under `withSystemContext` because there is no user context
 * yet — that is the very thing being established — and a read on the
 * pool-bound client with no context set returns zero rows silently, which
 * would make every token look invalid. Nothing but the token tables is
 * touched here, and the transaction is closed before any route opens its own.
 */
export async function authenticateToken(
  db: DbClient,
  token: string,
  now: Date,
): Promise<TokenAuthentication | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const hash = hashToken(token);

  return withSystemContext(db, async (tx) => {
    const [row] = await tx
      .select()
      .from(personalAccessTokens)
      .where(eq(personalAccessTokens.tokenHash, hash))
      .limit(1);
    // The index found the row by equality; this is the constant-time check
    // R8-5 asks for on the value that actually decides the match.
    if (!row || !hashesMatch(row.tokenHash, hash)) return null;
    if (row.revokedAt !== null) return null;
    if (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()) return null;

    const principal = await resolvePrincipalByUserId(tx, row.userId);
    if (!principal) return null;

    if (row.lastUsedAt === null || now.getTime() - row.lastUsedAt.getTime() >= LAST_USED_THROTTLE_MS) {
      await tx
        .update(personalAccessTokens)
        .set({ lastUsedAt: now })
        .where(eq(personalAccessTokens.id, row.id));
    }

    return {
      principal: { ...principal, permissions: intersectScopes(principal.permissions, row.scopes) },
      tokenId: row.id,
    };
  });
}
