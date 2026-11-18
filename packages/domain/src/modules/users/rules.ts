import { z } from "zod";
import type { Ctx } from "../../platform/context";
import { DEFAULT_DISPLAY_CURRENCY, DISPLAY_CURRENCIES } from "../../platform/fx/rules";
import { numberStyle } from "../../platform/format";

// The closed vocabularies of the preferences (audit USR-4): one list each, from which the zod
// schema, the columns and the CHECK constraints are made.
export const LOCALES = ["en", "it"] as const;
export const NUMBER_FORMATS = ["it-IT", "en-US", "fr-FR"] as const;
export const DECIMAL_SEPARATORS = [".", ","] as const;
export const CURRENCY_POSITIONS = ["before", "after"] as const;
export const THEMES = ["system", "light", "dark"] as const;
export const DEFAULT_RANGES = ["this_month", "last_30_days", "year_to_date"] as const;

const VALID_TIME_ZONES = new Set(Intl.supportedValuesOf("timeZone"));

/** Only a recognized IANA zone name is accepted; UTC-offset identifiers ("+01:00") are rejected. */
function canonicalTimeZone(value: string): string | null {
  if (!VALID_TIME_ZONES.has(value)) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
}

const patronSaintSchema = z
  .object({ month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) })
  .refine(({ month, day }) => {
    // 2023 is not a leap year, so 29 February is correctly rejected as an impossible day.
    const probe = new Date(Date.UTC(2023, month - 1, day));
    return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
  }, "Not a real calendar day");

export const preferencesInputSchema = z.object({
  timeZone: z
    .string()
    .refine((value) => canonicalTimeZone(value) !== null, "Unknown timezone")
    .transform((value) => canonicalTimeZone(value) as string),
  locale: z.enum(LOCALES),
  numberFormat: z.enum(NUMBER_FORMATS),
  // Both override the number format when set; null follows it (a point for en-US, a comma
  // otherwise), so the display of anyone who never touches them does not change.
  decimalSeparator: z.enum(DECIMAL_SEPARATORS).nullable(),
  currencyPosition: z.enum(CURRENCY_POSITIONS).nullable(),
  // What totals across accounts are shown in (§1.8, D1): EUR or a currency the ECB publishes, so
  // there is always a rate. A form written before the setting existed sends none and keeps EUR.
  displayCurrency: z.enum(DISPLAY_CURRENCIES).default(DEFAULT_DISPLAY_CURRENCY),
  weekStart: z.union([z.literal(0), z.literal(1)]),
  theme: z.enum(THEMES),
  defaultRange: z.enum(DEFAULT_RANGES),
  monthlySummary: z.boolean(),
  minutesPerDay: z.number().int().min(60).max(720),
  patronSaint: patronSaintSchema.nullable(),
});

export type Preferences = z.infer<typeof preferencesInputSchema>;

/** What Time off › Settings changes: only leave reads these, and each form saves its own. */
export const timeOffPreferencesSchema = preferencesInputSchema
  .pick({ minutesPerDay: true, patronSaint: true })
  .partial()
  .strict();
export type TimeOffPreferences = z.infer<typeof timeOffPreferencesSchema>;

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
  timeZone: "Europe/Rome",
  locale: "en",
  numberFormat: "it-IT",
  decimalSeparator: null,
  currencyPosition: null,
  displayCurrency: DEFAULT_DISPLAY_CURRENCY,
  weekStart: 1,
  theme: "light",
  defaultRange: "this_month",
  monthlySummary: false,
  minutesPerDay: 480,
  patronSaint: null,
});

/** A short, human label for a session's user agent (Settings › Security › Sessions). */
export function describeUserAgent(ua: string | null): { browser: string | null; os: string | null } {
  if (!ua) return { browser: null, os: null };
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  const browser = /Firefox\//.test(ua)
    ? "Firefox"
    : /Edg\//.test(ua)
      ? "Edge"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : null;
  return { browser, os };
}

// The refusals of Admin › Users are platform/auth's, with the people they protect.
export { personActionRefusal } from "../../platform/auth/people-rules";
export type { PersonAction, PersonRefusal } from "../../platform/auth/people-rules";

/**
 * The two letters of the round badge in Admin › Users (design row 874). A name gives its first
 * and last word's initials, an address falls back to the first two letters of its local part —
 * an invitation has no name yet, and an empty circle reads as a missing avatar rather than a
 * person who has not arrived.
 */
export function initialsOf(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    const first = words[0][0];
    const last = words.length > 1 ? words[words.length - 1][0] : (words[0][1] ?? "");
    return (first + last).toUpperCase();
  }
  return (email.split("@")[0] || "?").slice(0, 2).toUpperCase();
}

/**
 * The context a person acts in (audit USR-3): their role, language, zone, number format and display
 * currency. The session, an API token and a job all build it here; a job passes no role and acts
 * as a user.
 */
export function buildCtx(user: { id: string; role?: string | null }, preferences: Preferences): Ctx {
  return {
    userId: user.id,
    role: user.role === "admin" ? "admin" : "user",
    locale: preferences.locale,
    timeZone: preferences.timeZone,
    numberFormat: numberStyle(preferences),
    displayCurrency: preferences.displayCurrency,
  };
}
