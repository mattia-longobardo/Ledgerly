import { and, eq, sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { timeoffTypes, type TimeoffTypeRow } from "@/lib/db/schema";
import {
  TIMEOFF_CODE_ORDER,
  type TimeoffCode,
  type TimeoffType,
  type TypesRepository,
} from "../application/ports";

function toType(row: TimeoffTypeRow): TimeoffType {
  return {
    id: row.id,
    userId: row.userId,
    code: row.code as TimeoffCode,
    label: row.label,
    unit: row.unit as TimeoffType["unit"],
    hoursPerDay: row.hoursPerDay,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Postgres-backed time-off types. Like every other repository in this codebase
 * the `user_id` predicate is explicit as well as enforced by RLS, so the
 * intent survives a read taken under the system context.
 */
export class DrizzleTypesRepository implements TypesRepository {
  constructor(private readonly db: DbClient) {}

  async list(userId: string): Promise<TimeoffType[]> {
    // The catalogue order is a product decision, not an insertion accident:
    // `array_position` keeps it stable whatever order the rows were seeded in.
    const rows = await this.db
      .select()
      .from(timeoffTypes)
      .where(eq(timeoffTypes.userId, userId))
      .orderBy(sql`array_position(${sql.raw(`ARRAY[${TIMEOFF_CODE_ORDER.map((c) => `'${c}'`).join(",")}]::text[]`)}, ${timeoffTypes.code})`);
    return rows.map(toType);
  }

  async getByCode(userId: string, code: TimeoffCode): Promise<TimeoffType | null> {
    const [row] = await this.db
      .select()
      .from(timeoffTypes)
      .where(and(eq(timeoffTypes.userId, userId), eq(timeoffTypes.code, code)))
      .limit(1);
    return row ? toType(row) : null;
  }

  /**
   * Idempotent against a CONCURRENT first touch, not just a sequential one.
   *
   * `seedDefaultTypes` is check-then-insert, and two callers can reach it for
   * the same user at the same moment — the hourly Trek sync's seed and a
   * workspace load, or a payroll apply and a page render. Plain `INSERT` there
   * means the loser dies on `timeoff_types_user_code_uq` and takes its whole
   * transaction (an apply, a sync pass) with it. `ON CONFLICT DO NOTHING`
   * makes the loser a no-op instead; it blocks until the winner commits, so
   * the read below — a fresh statement snapshot under READ COMMITTED — always
   * sees the row that won.
   */
  async create(input: Omit<TimeoffType, "id" | "createdAt" | "updatedAt">): Promise<TimeoffType> {
    const [row] = await this.db
      .insert(timeoffTypes)
      .values(input)
      .onConflictDoNothing({ target: [timeoffTypes.userId, timeoffTypes.code] })
      .returning();
    if (row) return toType(row);
    const existing = await this.getByCode(input.userId, input.code);
    if (!existing) {
      // Not reachable through the unique index: the insert can only have been
      // a no-op because a row is there. Anything else is a bug worth hearing
      // about rather than a null the caller has to guess at.
      throw new Error(`timeoff type "${input.code}" neither inserted nor found`);
    }
    return existing;
  }
}
