// The first start and the defaults of the instance (rewrite plan R5a, E4, E8). A person signed up
// since R5a has a row with `onboarded_at` null until they choose their country, format and addons;
// the first admin's choice also becomes the instance's defaults, which a person signed up later
// starts from. A country with a pack proposes its values; one without a pack proposes nothing (D3).
import { z } from "zod";
import { ADDONS } from "@ledgerly/api-contract";
import { type Ctx, requireAdminCtx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { readSetting, writeSetting } from "../../../platform/settings";
import { countryRules, hasPack } from "../../../shared/country";
import { DEFAULT_PREFERENCES, preferencesInputSchema } from "../rules";
import { userPreferences } from "../schema";
import { getSavedPreferences, rowValues } from "./preferences";

/** The key of the defaults of the instance in `app_settings`. */
const INSTANCE_DEFAULTS = "instance.defaults";

const countrySchema = z
  .string()
  .regex(/^[A-Z]{2}$/)
  .nullable();

/** What the first start asks, and what the instance keeps as its defaults. */
const regionSchema = preferencesInputSchema
  .pick({ timeZone: true, numberFormat: true, locale: true, displayCurrency: true })
  .extend({ country: countrySchema });

export type Region = z.infer<typeof regionSchema>;

const onboardingSchema = regionSchema.extend({ addons: z.array(z.enum(ADDONS)) });

/** A refusal of the first start or of the instance's defaults. */
export class OnboardingError extends Error {
  constructor(readonly code: "forbidden") {
    super(code);
    this.name = "OnboardingError";
  }
}

/** The defaults the admin chose for the instance, or null before anyone chose them. */
export async function instanceDefaults(): Promise<Region | null> {
  const parsed = regionSchema.safeParse((await readSetting(INSTANCE_DEFAULTS))?.value);
  return parsed.success ? parsed.data : null;
}

/** Sets the defaults of the instance (admin only). */
export async function saveInstanceDefaults(
  ctx: Pick<Ctx, "role" | "userId">,
  input: unknown,
): Promise<Region> {
  requireAdminCtx(ctx, () => new OnboardingError("forbidden"));
  const region = regionSchema.parse(input);
  await writeSetting(INSTANCE_DEFAULTS, region, null, ctx.userId);
  return region;
}

/** What the first start proposes: the instance's defaults, then the pack of their country. */
function proposalFrom(instance: Region | null) {
  if (!instance) return null;
  const pack = hasPack(instance.country) ? countryRules(instance.country) : null;
  return { ...instance, weekStart: pack?.weekStart ?? DEFAULT_PREFERENCES.weekStart };
}

/**
 * A person just signed up (the hook of Better Auth): a row of preferences with the instance's
 * defaults, every addon off and the first start ahead of them: no addon is on before they choose it
 * (PA13). A person who already has a row keeps it.
 */
export async function startOnboarding(userId: string): Promise<void> {
  const proposal = proposalFrom(await instanceDefaults());
  const values = rowValues({ ...DEFAULT_PREFERENCES, ...(proposal ?? {}) });
  await getDb()
    .insert(userPreferences)
    .values({ ...values, userId, country: proposal?.country ?? null, modules: [], onboardedAt: null })
    .onConflictDoNothing({ target: userPreferences.userId });
}

/** The state of the first start of a person, and what it proposes. */
export async function onboardingOf(ctx: Pick<Ctx, "userId">) {
  const saved = await getSavedPreferences(ctx);
  return { pending: saved.onboarding, country: saved.country, proposal: await instanceDefaults() };
}

/**
 * Ends the first start: country, format and addons. The week starts as the country's pack says,
 * when it has one. The first admin's choice becomes the instance's defaults, when none are set.
 * A person may run it again: it changes the same fields.
 */
export async function completeOnboarding(ctx: Pick<Ctx, "userId" | "role">, input: unknown) {
  const choice = onboardingSchema.parse(input);
  const pack = hasPack(choice.country) ? countryRules(choice.country) : null;
  const values = {
    timeZone: choice.timeZone,
    locale: choice.locale,
    numberFormat: choice.numberFormat,
    displayCurrency: choice.displayCurrency,
    ...(pack ? { weekStart: pack.weekStart } : {}),
    country: choice.country,
    modules: ADDONS.filter((addon) => choice.addons.includes(addon)),
    onboardedAt: new Date(),
  };
  await getDb()
    .insert(userPreferences)
    .values(userScoped(ctx).stamp({ ...rowValues(DEFAULT_PREFERENCES), ...values }))
    .onConflictDoUpdate({ target: userPreferences.userId, set: values });
  if (ctx.role === "admin" && (await instanceDefaults()) === null) {
    const { addons, ...region } = choice;
    void addons;
    await writeSetting(INSTANCE_DEFAULTS, region, null, ctx.userId);
  }
  return onboardingOf(ctx);
}

/** Changes the person's country; the format they chose stays. */
export async function setCountry(ctx: Pick<Ctx, "userId">, country: unknown): Promise<string | null> {
  const value = countrySchema.parse(country);
  // A person without a row (made before R5a) gets one, with the first start behind them.
  await getDb()
    .insert(userPreferences)
    .values(
      userScoped(ctx).stamp({ ...rowValues(DEFAULT_PREFERENCES), country: value, onboardedAt: new Date() }),
    )
    .onConflictDoUpdate({ target: userPreferences.userId, set: { country: value } });
  return value;
}
