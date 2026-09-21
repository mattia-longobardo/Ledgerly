import { eq, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Ctx } from "@/platform/context";

/**
 * The only way services touch user-owned rows: `owns(table)` for WHERE clauses,
 * `stamp(values)` for inserts. Keeps one user's data out of another user's queries.
 */
export function userScoped(ctx: Pick<Ctx, "userId">) {
  return {
    owns(table: { userId: AnyPgColumn }): SQL {
      return eq(table.userId, ctx.userId);
    },
    stamp<V extends object>(values: V): V & { userId: string } {
      return { ...values, userId: ctx.userId };
    },
  };
}
