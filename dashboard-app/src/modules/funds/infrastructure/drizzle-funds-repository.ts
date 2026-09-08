import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { funds, type FundRow } from "@/lib/db/schema";
import { VersionMismatchError } from "../application/errors";
import type { Fund, FundPatch, FundsRepository, NewFund } from "../application/ports";

function toFund(row: FundRow): Fund {
  return {
    ...row,
    kind: row.kind as Fund["kind"],
    status: row.status as Fund["status"],
  };
}

export class DrizzleFundsRepository implements FundsRepository {
  constructor(private readonly db: DbClient) {}

  async list(userId: string, opts?: { includeArchived?: boolean }): Promise<Fund[]> {
    const owned = eq(funds.userId, userId);
    const rows = await this.db
      .select()
      .from(funds)
      .where(opts?.includeArchived ? owned : and(owned, ne(funds.status, "archived")))
      .orderBy(asc(funds.name), asc(funds.id));
    return rows.map(toFund);
  }

  async get(userId: string, id: string): Promise<Fund | null> {
    const [row] = await this.db.select().from(funds).where(and(eq(funds.userId, userId), eq(funds.id, id))).limit(1);
    return row ? toFund(row) : null;
  }

  /**
   * Locks the owned parent while callers write schedules, contributions, or
   * reversals in the same transaction. `NO KEY UPDATE` serializes those
   * writers while remaining compatible with the key-share locks acquired by
   * ordinary child-row foreign-key checks.
   */
  async lock(userId: string, id: string): Promise<Fund | null> {
    const [row] = await this.db
      .select()
      .from(funds)
      .where(and(eq(funds.userId, userId), eq(funds.id, id)))
      .limit(1)
      .for("no key update");
    return row ? toFund(row) : null;
  }

  async getBySlug(userId: string, slug: string): Promise<Fund | null> {
    const [row] = await this.db.select().from(funds).where(and(eq(funds.userId, userId), eq(funds.slug, slug))).limit(1);
    return row ? toFund(row) : null;
  }

  async create(input: NewFund): Promise<Fund> {
    const [row] = await this.db.insert(funds).values(input).returning();
    return toFund(row!);
  }

  async update(userId: string, id: string, expectedVersion: number, patch: FundPatch): Promise<Fund | null> {
    const [row] = await this.db
      .update(funds)
      .set({ ...patch, version: sql`${funds.version} + 1`, updatedAt: new Date() })
      .where(and(eq(funds.id, id), eq(funds.userId, userId), eq(funds.version, expectedVersion)))
      .returning();
    if (row) return toFund(row);
    if (await this.get(userId, id)) throw new VersionMismatchError();
    return null;
  }
}
