import "server-only";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { Ctx } from "@/platform/context";
import { DEFAULT_PREFERENCES, type Preferences, preferencesInputSchema } from "./rules";
import { userPreferences } from "./schema";

type Row = typeof userPreferences.$inferSelect;

function fromRow(row: Row): Preferences {
  return {
    timeZone: row.timeZone,
    locale: row.locale,
    numberFormat: row.numberFormat,
    weekStart: row.weekStart === 0 ? 0 : 1,
    theme: row.theme,
    defaultRange: row.defaultRange,
    monthlySummary: row.monthlySummary,
    minutesPerDay: row.minutesPerDay,
    patronSaint:
      row.patronMonth !== null && row.patronDay !== null
        ? { month: row.patronMonth, day: row.patronDay }
        : null,
  };
}

export async function getPreferences(ctx: Pick<Ctx, "userId">): Promise<Preferences> {
  const [row] = await getDb().select().from(userPreferences).where(userScoped(ctx).owns(userPreferences));
  return row ? fromRow(row) : DEFAULT_PREFERENCES;
}

export async function updatePreferences(ctx: Pick<Ctx, "userId">, input: unknown): Promise<Preferences> {
  const prefs = preferencesInputSchema.parse(input);
  const values = {
    timeZone: prefs.timeZone,
    locale: prefs.locale,
    numberFormat: prefs.numberFormat,
    weekStart: prefs.weekStart,
    theme: prefs.theme,
    defaultRange: prefs.defaultRange,
    monthlySummary: prefs.monthlySummary,
    minutesPerDay: prefs.minutesPerDay,
    patronMonth: prefs.patronSaint?.month ?? null,
    patronDay: prefs.patronSaint?.day ?? null,
  };
  const [row] = await getDb()
    .insert(userPreferences)
    .values(userScoped(ctx).stamp(values))
    .onConflictDoUpdate({ target: userPreferences.userId, set: values })
    .returning();
  return fromRow(row);
}
