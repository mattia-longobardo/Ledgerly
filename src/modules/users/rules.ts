import { z } from "zod";

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const patronSaintSchema = z
  .object({ month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) })
  .refine(({ month, day }) => {
    // 2024 is a leap year, so 29 February stays a valid choice.
    const probe = new Date(Date.UTC(2024, month - 1, day));
    return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
  }, "Not a real calendar day");

export const preferencesInputSchema = z.object({
  timeZone: z.string().refine(isTimeZone, "Unknown timezone"),
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

export const DEFAULT_PREFERENCES: Preferences = {
  timeZone: "Europe/Rome",
  locale: "en",
  numberFormat: "it-IT",
  weekStart: 1,
  theme: "light",
  defaultRange: "this_month",
  monthlySummary: false,
  minutesPerDay: 480,
  patronSaint: null,
};
