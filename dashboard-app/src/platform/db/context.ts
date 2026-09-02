import { sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";

export interface UserContext {
  userId: string;
  role?: "user" | "system";
}

/** set_config(..., true) is transaction-scoped: nothing leaks to the pooled connection. */
export async function withUserContext<T>(
  db: DbClient,
  ctx: UserContext,
  fn: (tx: DbClient) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.user_id', ${ctx.userId}, true), set_config('app.role', ${ctx.role ?? "user"}, true)`,
    );
    return fn(tx as unknown as DbClient);
  });
}

export async function withSystemContext<T>(db: DbClient, fn: (tx: DbClient) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', '', true), set_config('app.role', 'system', true)`);
    return fn(tx as unknown as DbClient);
  });
}
