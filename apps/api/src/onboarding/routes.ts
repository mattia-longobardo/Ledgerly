// The first start and the defaults of the instance (rewrite plan R5a, E4, E8).
import type { Hono } from "hono";
import { ONBOARDING, ONBOARDING_ROUTES, type RouteContract } from "@ledgerly/api-contract";
import { COUNTRIES, countryRules } from "@ledgerly/domain/shared/country";
import {
  completeOnboarding,
  instanceDefaults,
  OnboardingError,
  onboardingOf,
  saveInstanceDefaults,
  setCountry,
} from "@ledgerly/domain/users";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";

export function serveOnboarding(app: Hono<ApiEnv>, guard: Guard): readonly RouteContract[] {
  serve(app, guard, ONBOARDING.listCountries, async () => ({
    countries: COUNTRIES.map((country) => {
      const { interestTaxPercent, currency, timeZone, numberFormat, locale, weekStart } =
        countryRules(country);
      return { country, currency, timeZone, numberFormat, locale, weekStart, interestTaxPercent };
    }),
  }));
  serve(app, guard, ONBOARDING.getOnboarding, ({ ctx }) => onboardingOf(ctx));
  serve(app, guard, ONBOARDING.completeOnboarding, ({ ctx, body }) => completeOnboarding(ctx, body));
  serve(app, guard, ONBOARDING.setCountry, async ({ ctx, body }) => ({
    country: await setCountry(ctx, body.country),
  }));
  serve(app, guard, ONBOARDING.getInstanceDefaults, async () => ({ defaults: await instanceDefaults() }));
  serve(app, guard, ONBOARDING.saveInstanceDefaults, async ({ ctx, body }) => {
    try {
      return { defaults: await saveInstanceDefaults(ctx, body) };
    } catch (error) {
      if (error instanceof OnboardingError) throw new ApiRefusal("forbidden");
      throw error;
    }
  });
  return ONBOARDING_ROUTES;
}
