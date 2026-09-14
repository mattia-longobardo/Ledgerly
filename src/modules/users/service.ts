import "server-only";
import { and, desc, eq, gt } from "drizzle-orm";
import { sessions } from "@/platform/auth/schema";
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
  return row ? fromRow(row) : { ...DEFAULT_PREFERENCES };
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

/**
 * The token of one of the user's own sessions, or null. The Security page sends only session ids
 * to the browser; the revoke action resolves the token here, by id AND owner.
 */
export async function findSessionToken(ctx: Pick<Ctx, "userId">, sessionId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ token: sessions.token })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), userScoped(ctx).owns(sessions)));
  return row?.token ?? null;
}

export interface OwnSession {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
}

/**
 * The caller's own active (non-expired) sessions, newest first. Never selects the token — the
 * Security page sends only these fields to the browser. `auth.api.listSessions` cannot be used
 * here: it runs behind Better Auth's fresh-session gate (spec: freshAge 24h), so it would refuse
 * any session older than a day even though listing your own sessions is not a sensitive action.
 */
export async function listOwnSessions(ctx: Pick<Ctx, "userId">): Promise<OwnSession[]> {
  return getDb()
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      ipAddress: sessions.ipAddress,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(and(userScoped(ctx).owns(sessions), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.createdAt), desc(sessions.id));
}
