import { and, desc, eq, isNull } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { personalAccessTokens, type PersonalAccessTokenRow } from "@/lib/db/schema";
import type { Permission } from "@/platform/auth/permissions";
import type { NewToken, TokenRecord, TokensRepository } from "../application/ports";

/**
 * Maps a row to the port type. `tokenHash` is dropped here, at the boundary,
 * so no layer above the repository can leak it by accident.
 */
function toRecord(row: PersonalAccessTokenRow): TokenRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes as Permission[],
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

/**
 * Postgres-backed tokens. Like every other repository here the `user_id`
 * predicate is explicit as well as enforced by RLS, so the intent survives a
 * read taken under the system context.
 */
export class DrizzleTokensRepository implements TokensRepository {
  constructor(private readonly db: DbClient) {}

  async list(userId: string): Promise<TokenRecord[]> {
    const rows = await this.db
      .select()
      .from(personalAccessTokens)
      .where(eq(personalAccessTokens.userId, userId))
      .orderBy(desc(personalAccessTokens.createdAt), desc(personalAccessTokens.id));
    return rows.map(toRecord);
  }

  async create(input: NewToken): Promise<TokenRecord> {
    const [row] = await this.db
      .insert(personalAccessTokens)
      .values({
        userId: input.userId,
        name: input.name,
        prefix: input.prefix,
        tokenHash: input.tokenHash,
        scopes: input.scopes,
        expiresAt: input.expiresAt,
      })
      .returning();
    return toRecord(row!);
  }

  /**
   * `revoked_at IS NULL` in the predicate, not just the id: revoking twice
   * must report "nothing to do" rather than moving the timestamp forward and
   * rewriting when the credential actually died.
   */
  async revoke(userId: string, id: string, at: Date): Promise<TokenRecord | null> {
    const [row] = await this.db
      .update(personalAccessTokens)
      .set({ revokedAt: at })
      .where(
        and(
          eq(personalAccessTokens.id, id),
          eq(personalAccessTokens.userId, userId),
          isNull(personalAccessTokens.revokedAt),
        ),
      )
      .returning();
    return row ? toRecord(row) : null;
  }
}
