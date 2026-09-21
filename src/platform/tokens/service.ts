import "server-only";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getPreferences } from "@/modules/users/service";
import { users } from "@/platform/auth/schema";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import { numberStyle } from "@/platform/format";
import {
  type ExpiryChoice,
  expiryFrom,
  MAX_TOKEN_NAME,
  mintToken,
  parseScopes,
  parseToken,
  sameHash,
  type Scope,
  TOKEN_SCOPES,
  type TokenState,
  tokenState,
  TOUCH_INTERVAL_MS,
} from "./rules";
import { personalAccessTokens } from "./schema";

/**
 * Personal access tokens (spec §5.3): created and revoked from Settings › Security with a session,
 * and spent on `/api/v1`.
 *
 * A token never outranks the person who made it. `authenticateToken` builds the same `Ctx` a
 * session would, so every service downstream scopes its queries with `userScoped(ctx)` exactly as
 * it does for the screen, and no administrative surface exists under `/api/v1` at all: the scope
 * is a second gate, never the first (plan F8 §3.4.8).
 */

export class TokenError extends Error {
  constructor(readonly code: "invalid" | "not_found") {
    super(code);
    this.name = "TokenError";
  }
}

/** A token as the screen sees it: the prefix, never the secret, which is gone after its one look. */
export interface TokenView {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  state: TokenState;
}

const VIEW_COLUMNS = {
  id: personalAccessTokens.id,
  name: personalAccessTokens.name,
  prefix: personalAccessTokens.prefix,
  scopes: personalAccessTokens.scopes,
  expiresAt: personalAccessTokens.expiresAt,
  lastUsedAt: personalAccessTokens.lastUsedAt,
  revokedAt: personalAccessTokens.revokedAt,
  createdAt: personalAccessTokens.createdAt,
};

type ViewRow = { [K in keyof typeof VIEW_COLUMNS]: (typeof personalAccessTokens.$inferSelect)[K] };

function toView(row: ViewRow, now: Date): TokenView {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes as Scope[],
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    state: tokenState(row, now),
  };
}

export async function listTokens(ctx: Pick<Ctx, "userId">, now: Date = new Date()): Promise<TokenView[]> {
  const rows = await getDb()
    .select(VIEW_COLUMNS)
    .from(personalAccessTokens)
    .where(userScoped(ctx).owns(personalAccessTokens))
    .orderBy(desc(personalAccessTokens.createdAt), desc(personalAccessTokens.id));
  return rows.map((row) => toView(row, now));
}

const createInput = z.object({
  name: z.string().trim().min(1).max(MAX_TOKEN_NAME),
  scopes: z.array(z.enum(TOKEN_SCOPES)).min(1),
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.null()]),
});

/**
 * Mints a token and returns its value **once**. Only the prefix and the digest reach the database,
 * so nothing — not this function, not a backup, not an admin — can show it again.
 */
export async function createToken(
  ctx: Pick<Ctx, "userId">,
  input: { name: string; scopes: readonly string[]; expiresInDays: ExpiryChoice },
  now: Date = new Date(),
): Promise<{ view: TokenView; token: string }> {
  const parsed = createInput.safeParse(input);
  if (!parsed.success) throw new TokenError("invalid");
  const scopes = parseScopes(parsed.data.scopes);
  if (!scopes) throw new TokenError("invalid");
  const { token, prefix, hash } = mintToken();
  const [row] = await getDb()
    .insert(personalAccessTokens)
    .values(
      userScoped(ctx).stamp({
        name: parsed.data.name,
        prefix,
        tokenHash: hash,
        scopes,
        expiresAt: expiryFrom(parsed.data.expiresInDays, now),
      }),
    )
    .returning(VIEW_COLUMNS);
  return { view: toView(row, now), token };
}

/**
 * Takes a token back. Revoked rather than deleted: the row is the only record that the token ever
 * existed, and a person looking at a suspicious `last_used_at` needs it to still be there.
 */
export async function revokeToken(
  ctx: Pick<Ctx, "userId">,
  id: string,
  now: Date = new Date(),
): Promise<void> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) throw new TokenError("invalid");
  const revoked = await getDb()
    .update(personalAccessTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(personalAccessTokens.id, parsed.data),
        userScoped(ctx).owns(personalAccessTokens),
        isNull(personalAccessTokens.revokedAt),
      ),
    )
    .returning({ id: personalAccessTokens.id });
  if (revoked.length === 0) throw new TokenError("not_found");
}

export interface TokenIdentity {
  ctx: Ctx;
  scopes: Scope[];
  tokenId: string;
}

/**
 * Who a bearer token is, or null. Null covers every reason at once — malformed, unknown, revoked,
 * expired, or belonging to a blocked person — because telling them apart tells a caller which
 * guess was close.
 *
 * The digest is compared in constant time even though the row was found by its prefix: the prefix
 * is public, the digest is not, and a length-sensitive `===` on it is a free oracle.
 */
export async function authenticateToken(
  value: string,
  now: Date = new Date(),
): Promise<TokenIdentity | null> {
  const parsed = parseToken(value);
  if (!parsed) return null;
  const [row] = await getDb()
    .select({
      id: personalAccessTokens.id,
      userId: personalAccessTokens.userId,
      tokenHash: personalAccessTokens.tokenHash,
      scopes: personalAccessTokens.scopes,
      expiresAt: personalAccessTokens.expiresAt,
      revokedAt: personalAccessTokens.revokedAt,
      role: users.role,
      banned: users.banned,
    })
    .from(personalAccessTokens)
    .innerJoin(users, eq(users.id, personalAccessTokens.userId))
    .where(eq(personalAccessTokens.prefix, parsed.prefix));
  if (!row || !sameHash(row.tokenHash, parsed.hash)) return null;
  if (tokenState(row, now) !== "active") return null;
  // A blocked person is blocked everywhere, not only at the sign-in form.
  if (row.banned) return null;
  const preferences = await getPreferences({ userId: row.userId });
  return {
    ctx: {
      userId: row.userId,
      role: row.role === "admin" ? "admin" : "user",
      locale: preferences.locale,
      timeZone: preferences.timeZone,
      numberFormat: numberStyle(preferences),
    },
    scopes: row.scopes as Scope[],
    tokenId: row.id,
  };
}

/**
 * Records that a token was used, at most once a minute (spec §5.3): the condition is in the
 * statement itself, so a call a second is not a write a second and two workers cannot both write.
 */
export async function touchToken(id: string, now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - TOUCH_INTERVAL_MS);
  await getDb()
    .update(personalAccessTokens)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(personalAccessTokens.id, id),
        or(isNull(personalAccessTokens.lastUsedAt), lt(personalAccessTokens.lastUsedAt, cutoff)),
      ),
    );
}

/** Drops tokens revoked or expired long ago, for the daily housekeeping job. */
export async function deleteStaleTokens(cutoff: Date): Promise<number> {
  const rows = await getDb()
    .delete(personalAccessTokens)
    .where(
      or(
        lt(personalAccessTokens.revokedAt, cutoff),
        and(sql`${personalAccessTokens.expiresAt} is not null`, lt(personalAccessTokens.expiresAt, cutoff)),
      ),
    )
    .returning({ id: personalAccessTokens.id });
  return rows.length;
}
