import { z } from "zod";
import type { Role } from "@/platform/context";

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
  locale: z.enum(["en", "it"]),
  numberFormat: z.enum(["it-IT", "en-US", "fr-FR"]),
  // Both override the number format when set; null follows it (a point for en-US, a comma
  // otherwise), so the display of anyone who never touches them does not change.
  decimalSeparator: z.enum([".", ","]).nullable(),
  currencyPosition: z.enum(["before", "after"]).nullable(),
  weekStart: z.union([z.literal(0), z.literal(1)]),
  theme: z.enum(["system", "light", "dark"]),
  defaultRange: z.enum(["this_month", "last_30_days", "year_to_date"]),
  monthlySummary: z.boolean(),
  minutesPerDay: z.number().int().min(60).max(720),
  patronSaint: patronSaintSchema.nullable(),
});

export type Preferences = z.infer<typeof preferencesInputSchema>;

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
  timeZone: "Europe/Rome",
  locale: "en",
  numberFormat: "it-IT",
  decimalSeparator: null,
  currencyPosition: null,
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

/* Admin › Users (spec §7.10) — the two refusals that keep an instance governable. */

export type PersonAction = "demote" | "block" | "remove";

export type PersonRefusal = "self" | "last_admin";

/**
 * Why an admin action on a person must be refused, or null when it may go ahead.
 *
 * 1. **The last admin is untouchable.** Removing their role, blocking them or deleting them leaves
 *    an instance nobody can administer, and the only repair is a shell in the container. A screen
 *    that lets someone wall themselves out is a defect, not a feature (plan F8 §3.4.1).
 * 2. **Nobody blocks or removes themselves.** Both are one-way doors taken by accident; a second
 *    admin can always do it on their behalf, which is exactly the review that makes it safe.
 *
 * Demoting *yourself* is allowed while another admin remains: it is reversible by that admin, and
 * an admin who no longer wants the role should not have to ask someone else for it.
 */
export function personActionRefusal(
  action: PersonAction,
  input: { actorId: string; targetId: string; targetRole: Role; adminCount: number },
): PersonRefusal | null {
  const { actorId, targetId, targetRole, adminCount } = input;
  if (targetRole === "admin" && adminCount <= 1) return "last_admin";
  if (actorId === targetId && action !== "demote") return "self";
  return null;
}

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
