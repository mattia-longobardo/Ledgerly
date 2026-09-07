import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown) {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

export const SETTING_KEYS = {
  hoursPerDay: "hours_per_day",
  firstRunComplete: "first_run_complete",
  ferieTakenByMonth: "ferie_taken_by_month",
  /**
   * OpenAI-compatible LLM for the payslip pass. `llmApiKey` holds a secret: it
   * is read only by `resolveLlmConfig()` on the server and must never be sent
   * to a client component, an error message or a `job_runs` row.
   */
  llmApiKey: "llm_api_key",
  llmBaseUrl: "llm_base_url",
  llmModel: "llm_model",
} as const;

/**
 * Hours in a working day, used to convert the hour-denominated figures a
 * payslip states into days. Moved here from `src/app/(app)/_lib/vacation.ts`
 * when Phase 7 deleted that file (R7-5'): the timeoff module needs it and no
 * page owns it.
 */
export const DEFAULT_HOURS_PER_DAY = 8;

export async function hoursPerDay(): Promise<number> {
  const raw = await getSetting<unknown>(SETTING_KEYS.hoursPerDay, DEFAULT_HOURS_PER_DAY);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_HOURS_PER_DAY;
}
