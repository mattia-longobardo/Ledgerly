import { z } from "zod";

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
  weekStart: 1,
  theme: "light",
  defaultRange: "this_month",
  monthlySummary: false,
  minutesPerDay: 480,
  patronSaint: null,
});
