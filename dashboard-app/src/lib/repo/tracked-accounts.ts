import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { trackedAccounts, type TrackedAccount } from "@/lib/db/schema";

/**
 * The hand-tracked account registry — the source of truth for WHICH accounts
 * the owner keeps by hand in Teable. It is intentionally independent of whether
 * Teable still holds the column: an account listed here but with no column (or
 * an empty cell) is valued at 0, never dropped.
 */

/** Every registered account, in the owner's chosen display order. */
export async function list(): Promise<TrackedAccount[]> {
  return db
    .select()
    .from(trackedAccounts)
    .orderBy(asc(trackedAccounts.sortOrder), asc(trackedAccounts.slug));
}

export async function get(slug: string): Promise<TrackedAccount | null> {
  const [row] = await db
    .select()
    .from(trackedAccounts)
    .where(eq(trackedAccounts.slug, slug))
    .limit(1);
  return row ?? null;
}

/** Hide/show only flips the list flag; the account keeps counting in the total. */
export async function setVisible(slug: string, visible: boolean): Promise<TrackedAccount | null> {
  const [row] = await db
    .update(trackedAccounts)
    .set({ visible })
    .where(eq(trackedAccounts.slug, slug))
    .returning();
  return row ?? null;
}

/**
 * Permanent: the account leaves the registry and therefore stops contributing
 * to the total, appearing in any list, and being written by the sweep. The
 * Teable column is dealt with by the caller (`deleteAccount`), not here — this
 * repo only owns the row.
 */
export async function remove(slug: string): Promise<TrackedAccount | null> {
  const [row] = await db
    .delete(trackedAccounts)
    .where(eq(trackedAccounts.slug, slug))
    .returning();
  return row ?? null;
}
