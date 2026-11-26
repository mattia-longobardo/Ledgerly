import { sql } from "drizzle-orm";
import { withOwnConnection } from "../db/client";

/** The keys this process holds: a second caller is refused at once, with no connection (SEC-09). */
const held = new Set<string>();

/**
 * Session-level advisory lock on one dedicated connection, outside the pool, with no transaction
 * open, so a job's network calls never run inside a transaction. A second caller gets
 * `{ ran: false }`, from this process or another one.
 */
export async function withJobLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<{ ran: true; value: T } | { ran: false }> {
  if (held.has(key)) return { ran: false };
  held.add(key);
  try {
    return await withOwnConnection(async (own) => {
      const { rows } = await own.execute<{ locked: boolean }>(
        sql`SELECT pg_try_advisory_lock(hashtext(${key})) AS locked`,
      );
      if (!rows[0]?.locked) return { ran: false };
      try {
        return { ran: true, value: await fn() };
      } finally {
        await own.execute(sql`SELECT pg_advisory_unlock(hashtext(${key}))`);
      }
    });
  } finally {
    held.delete(key);
  }
}
