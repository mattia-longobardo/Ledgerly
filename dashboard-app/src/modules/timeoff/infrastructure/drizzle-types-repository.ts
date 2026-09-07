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

  async create(input: Omit<TimeoffType, "id" | "createdAt" | "updatedAt">): Promise<TimeoffType> {
    const [row] = await this.db.insert(timeoffTypes).values(input).returning();
    return toType(row!);
  }
}
