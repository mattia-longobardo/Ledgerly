import "server-only";
import { getPool } from "@/platform/db/client";

/**
 * Session-level advisory lock on one dedicated connection, with no transaction open, so a
 * job's network calls never run inside a transaction. A second caller gets `{ ran: false }`.
 */
export async function withJobLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<{ ran: true; value: T } | { ran: false }> {
  const client = await getPool().connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [key],
    );
    if (!rows[0]?.locked) return { ran: false };
    try {
      return { ran: true, value: await fn() };
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]);
    }
  } finally {
    client.release();
  }
}
