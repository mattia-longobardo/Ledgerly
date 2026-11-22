// Users and settings · profile and preferences (rewrite plan R2, 05-refactor.md §5.5): the person's
// own name and the preferences every page renders with. One `PATCH` per area replaces the three
// forms that each sent the whole object (USR-6): a field left out keeps its value.
import { z } from "zod";
import { defineRoute } from "../route";
import { id } from "../primitives";

const patronSaint = z.object({
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
});

const preferences = z.object({
  /** An IANA zone name; dates of every answer are civil dates in this zone. */
  timeZone: z.string(),
  locale: z.enum(["en", "it"]),
  numberFormat: z.enum(["it-IT", "en-US", "fr-FR"]),
  decimalSeparator: z.enum([".", ","]).nullable(),
  currencyPosition: z.enum(["before", "after"]).nullable(),
  /** What totals across accounts are shown in: EUR or a currency the ECB publishes. */
  displayCurrency: z.string().length(3),
  weekStart: z.union([z.literal(0), z.literal(1)]),
  theme: z.enum(["system", "light", "dark"]),
  defaultRange: z.enum(["this_month", "last_30_days", "year_to_date"]),
  monthlySummary: z.boolean(),
  /** «Nascondi importi» (R5e, G5): every client of the person hides amounts while it is on. */
  hideAmounts: z.boolean(),
  /** Time off: the minutes of a working day. */
  minutesPerDay: z.number().int().min(60).max(720),
  patronSaint: patronSaint.nullable(),
});

const PREFERENCES_EXAMPLE = {
  timeZone: "Europe/Rome",
  locale: "en",
  numberFormat: "it-IT",
  decimalSeparator: null,
  currencyPosition: null,
  displayCurrency: "EUR",
  weekStart: 1,
  theme: "system",
  defaultRange: "this_month",
  monthlySummary: false,
  hideAmounts: false,
  minutesPerDay: 480,
  patronSaint: null,
};

export const getPreferences = defineRoute({
  id: "get_preferences",
  method: "GET",
  path: "/preferences",
  scope: "read",
  capability: "preferences",
  summary: "The person's preferences: language, zone, number format, display currency, theme, time off.",
  actions: [],
  response: preferences,
  errors: [],
  mcp: {
    title: "Preferences",
    description:
      "The user's preferences, as GET /api/v1/preferences: time zone, language, number format, display " +
      "currency, first day of the week, theme, and the working day of Time off.",
  },
  example: { response: PREFERENCES_EXAMPLE },
});

export const updatePreferences = defineRoute({
  id: "update_preferences",
  method: "PATCH",
  path: "/preferences",
  scope: "write",
  capability: "preferences",
  summary:
    "Changes some preferences; a field left out keeps its value. A new zone moves the sync times with it.",
  actions: [],
  body: preferences.partial().strict(),
  response: preferences,
  errors: ["invalid"],
  example: {
    body: { theme: "dark", minutesPerDay: 450 },
    response: { ...PREFERENCES_EXAMPLE, theme: "dark", minutesPerDay: 450 },
  },
});

const profile = z.object({
  id: id(),
  name: z.string(),
  email: z.string(),
  role: z.enum(["admin", "user"]),
  /** True when the identity provider manages name and email: `PATCH /profile` refuses them. */
  managedByProvider: z.boolean(),
  twoFactor: z.boolean(),
});

const PROFILE_EXAMPLE = {
  id: "7d4f1c2e-9b8a-4c3d-8e5f-1a2b3c4d5e6f",
  name: "Alex Example",
  email: "alex@example.test",
  role: "user",
  managedByProvider: false,
  twoFactor: true,
};

export const getProfile = defineRoute({
  id: "get_profile",
  method: "GET",
  path: "/profile",
  scope: "read",
  capability: "profile",
  summary: "Who the token acts for: name, email, role, and whether the identity provider manages them.",
  actions: [],
  response: profile,
  errors: [],
  mcp: { title: "Profile", description: "The user's name, email and role, as GET /api/v1/profile." },
  example: { response: PROFILE_EXAMPLE },
});

export const updateProfile = defineRoute({
  id: "update_profile",
  method: "PATCH",
  path: "/profile",
  scope: "write",
  capability: "profile",
  summary: "Changes the person's name. Refused with `conflict` (`reason: sso`) when the provider manages it.",
  actions: [],
  body: z.object({ name: z.string().trim().min(1).max(120) }).strict(),
  response: profile,
  errors: ["invalid", "conflict"],
  example: { body: { name: "Alex Sample" }, response: { ...PROFILE_EXAMPLE, name: "Alex Sample" } },
});

export const getProfileOptions = defineRoute({
  id: "get_profile_options",
  method: "GET",
  path: "/profile/options",
  scope: "read",
  capability: "profile",
  summary:
    "What the Profile form offers: the time zones with their offset now, and whether the instance sends the monthly summary.",
  actions: [],
  response: z.object({
    timeZones: z.array(z.object({ zone: z.string(), offset: z.string() })),
    /** False when an admin turned the monthly summary off for the instance. */
    monthlySummaryAllowed: z.boolean(),
  }),
  errors: [],
  example: {
    response: {
      timeZones: [{ zone: "Europe/Rome", offset: "UTC+1" }],
      monthlySummaryAllowed: true,
    },
  },
});
