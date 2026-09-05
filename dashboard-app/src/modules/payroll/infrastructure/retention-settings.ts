import { eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { appSettings } from "@/lib/db/schema";
import { DEFAULT_RETENTION_YEARS } from "../application/create-import";

export const RETENTION_SETTING_KEY = "payroll_retention_years";

/**
 * Spec §13.5: ten years by default, configurable. `app_settings` is the
 * existing global key/jsonb table (no RLS, one row per key), so this is a plain
 * read on the caller's transaction.
 *
 * Anything that is not a positive integer falls back to the default rather than
 * throwing: a malformed settings row must not make every upload fail, and a
 * retention window of `0` or `-1` would hand the purge job the entire archive
 * on its next tick.
 */
export async function readRetentionYears(tx: DbClient): Promise<number> {
  const [row] = await tx.select().from(appSettings).where(eq(appSettings.key, RETENTION_SETTING_KEY)).limit(1);
  const value = row?.value;
  const years = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(years) && years > 0 ? years : DEFAULT_RETENTION_YEARS;
}
