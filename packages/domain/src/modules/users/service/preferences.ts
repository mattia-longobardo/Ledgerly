import { and, desc, eq, gt } from "drizzle-orm";
import { sessions } from "../../../platform/auth/schema";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import type { Ctx } from "../../../platform/context";
import { DEFAULT_DISPLAY_CURRENCY, isDisplayCurrency } from "../../../platform/fx/rules";
import {
  DEFAULT_PREFERENCES,
  type Preferences,
  preferencesInputSchema,
  timeOffPreferencesSchema,
} from "../rules";
import { userPreferences } from "../schema";
import { ADDONS, type AddonId } from "@ledgerly/api-contract";

type Row = typeof userPreferences.$inferSelect;

/**
 * The preferences as saved, with what R5a adds: the addons the person has on (H52), their country
 * (E4) and whether the first start is still ahead of them.
 */
export type SavedPreferences = Preferences & {
  addons: AddonId[];
  country: string | null;
  onboarding: boolean;
};

/** The saved list, in the order of `ADDONS`; a name the list no longer has is dropped. */
const addonsOf = (modules: readonly string[]): AddonId[] => ADDONS.filter((addon) => modules.includes(addon));

function fromRow(row: Row): Preferences {
  return {
    timeZone: row.timeZone,
    locale: row.locale,
    numberFormat: row.numberFormat,
    decimalSeparator: row.decimalSeparator,
    currencyPosition: row.currencyPosition,
    displayCurrency: isDisplayCurrency(row.displayCurrency) ? row.displayCurrency : DEFAULT_DISPLAY_CURRENCY,
    weekStart: row.weekStart === 0 ? 0 : 1,
    theme: row.theme,
    defaultRange: row.defaultRange,
    monthlySummary: row.monthlySummary,
    hideAmounts: row.hideAmounts,
    minutesPerDay: row.minutesPerDay,
  };
}

async function ownRow(ctx: Pick<Ctx, "userId">): Promise<Row | undefined> {
  const [row] = await getDb().select().from(userPreferences).where(userScoped(ctx).owns(userPreferences));
  return row;
}

/** The preferences and what R5a adds, in one read: what a context is built from. */
export async function getSavedPreferences(ctx: Pick<Ctx, "userId">): Promise<SavedPreferences> {
  const row = await ownRow(ctx);
  // No row: a person made before R5a, or straight in the database. Every addon is on and the
  // first start is behind them (PA13); a person signed up since R5a gets a row (`startOnboarding`).
  return row
    ? {
        ...fromRow(row),
        addons: addonsOf(row.modules),
        country: row.country,
        onboarding: row.onboardedAt === null,
      }
    : { ...DEFAULT_PREFERENCES, addons: [...ADDONS], country: null, onboarding: false };
}

export async function getPreferences(ctx: Pick<Ctx, "userId">): Promise<Preferences> {
  const row = await ownRow(ctx);
  return row ? fromRow(row) : { ...DEFAULT_PREFERENCES };
}

/**
 * Turns one addon on or off (H52, PA10): only the list changes. The addon's data stays as it is, so
 * turning it back on shows it as it was; nothing it missed while off is written afterwards (D8).
 */
export async function setAddon(
  ctx: Pick<Ctx, "userId">,
  addon: AddonId,
  active: boolean,
): Promise<AddonId[]> {
  const current = (await getSavedPreferences(ctx)).addons;
  const modules = active ? addonsOf([...current, addon]) : current.filter((other) => other !== addon);
  // A person with no row yet gets one with the defaults, then the list.
  const values = { ...rowValues({ ...DEFAULT_PREFERENCES }), modules };
  const [row] = await getDb()
    .insert(userPreferences)
    .values(userScoped(ctx).stamp(values))
    .onConflictDoUpdate({ target: userPreferences.userId, set: { modules } })
    .returning({ modules: userPreferences.modules });
  return addonsOf(row.modules);
}

export async function updatePreferences(ctx: Pick<Ctx, "userId">, input: unknown): Promise<Preferences> {
  const values = rowValues(preferencesInputSchema.parse(input));
  const [row] = await getDb()
    .insert(userPreferences)
    .values(userScoped(ctx).stamp(values))
    .onConflictDoUpdate({ target: userPreferences.userId, set: values })
    .returning();
  return fromRow(row);
}

/** The columns of the preferences; `modules` is not one of them (`setAddon`). */
export function rowValues(prefs: Preferences) {
  return {
    timeZone: prefs.timeZone,
    locale: prefs.locale,
    numberFormat: prefs.numberFormat,
    decimalSeparator: prefs.decimalSeparator,
    currencyPosition: prefs.currencyPosition,
    displayCurrency: prefs.displayCurrency,
    weekStart: prefs.weekStart,
    theme: prefs.theme,
    defaultRange: prefs.defaultRange,
    monthlySummary: prefs.monthlySummary,
    hideAmounts: prefs.hideAmounts,
    minutesPerDay: prefs.minutesPerDay,
  };
}

/** What the Profile form may change: the fields it sends of Time off are dropped, not saved. */
const profileFormSchema = preferencesInputSchema.omit({
  // Not a field of the Profile form: a form that does not send it must not turn it off.
  hideAmounts: true,
  minutesPerDay: true,
  defaultRange: true,
});

/** A change of some preferences: a field left out keeps its value. */
const preferencesPatchSchema = preferencesInputSchema.partial().strict();

/**
 * The one way to change preferences (audit USR-6): a partial change over the saved row, for every
 * form and for `PATCH /api/v1/preferences`. `timeZoneChanged` tells the caller to move what follows
 * the zone (the schedules of the connections, D7): that composition is the app's.
 */
export async function changePreferences(
  ctx: Pick<Ctx, "userId">,
  patch: unknown,
): Promise<{ preferences: Preferences; timeZoneChanged: boolean }> {
  const change = preferencesPatchSchema.parse(patch);
  const current = await getPreferences(ctx);
  const preferences = await updatePreferences(ctx, { ...current, ...change });
  return { preferences, timeZoneChanged: preferences.timeZone !== current.timeZone };
}

/**
 * What the Profile form saves. Hours are not its to write any more (PERS-158): they
 * are left out, so a form loaded before a change on Time off › Settings cannot put the old values
 * back. `defaultRange` has no control left and nothing reads it: it just stays as it is.
 */
export async function updateProfilePreferences(
  ctx: Pick<Ctx, "userId">,
  input: unknown,
): Promise<Preferences> {
  return (await changePreferences(ctx, profileChange(input))).preferences;
}

/** The change the Profile form asks for: its fields of Time off are dropped, not saved. */
export function profileChange(input: unknown): Partial<Preferences> {
  return profileFormSchema.parse(input);
}

/** What Time off › Settings saves: only the fields it names, the rest of the row stays. */
export async function updateTimeOffPreferences(
  ctx: Pick<Ctx, "userId">,
  input: unknown,
): Promise<Preferences> {
  return (await changePreferences(ctx, timeOffPreferencesSchema.parse(input))).preferences;
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
