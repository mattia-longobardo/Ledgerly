// The first start and the defaults of the instance (rewrite plan R5a, E4, E8): «Paese e formato»
// proposed by the browser, the country's pack proposing the rest, the addons chosen (PA13). A
// country without a pack proposes nothing: its fields stay empty (D3).
import { z } from "zod";
import { ADDONS } from "./addons";
import { defineRoute } from "./route";

const country = z
  .string()
  .regex(/^[A-Z]{2}$/)
  .nullable();

/** Country and format: what the first start asks and what the instance keeps as its defaults. */
const region = z.object({
  /** ISO 3166-1 alpha-2; null for a person who chose no country. */
  country,
  /** What totals are shown in: EUR or a currency the ECB publishes. */
  displayCurrency: z.string().length(3),
  /** An IANA zone name. */
  timeZone: z.string(),
  numberFormat: z.enum(["it-IT", "en-US", "fr-FR"]),
  locale: z.enum(["en", "it"]),
});

const REGION_EXAMPLE = {
  country: "IT",
  displayCurrency: "EUR",
  timeZone: "Europe/Rome",
  numberFormat: "it-IT",
  locale: "it",
};

const pack = z.object({
  country: z.string(),
  currency: z.string().length(3),
  timeZone: z.string(),
  numberFormat: z.enum(["it-IT", "en-US", "fr-FR"]),
  locale: z.enum(["en", "it"]),
  weekStart: z.union([z.literal(0), z.literal(1)]),
  /** The tax on interest, in percent, that a new interest rule proposes. */
  interestTaxPercent: z.string(),
});

export const listCountries = defineRoute({
  id: "list_countries",
  method: "GET",
  path: "/countries",
  scope: "read",
  capability: "onboarding",
  summary: "The countries with a pack of rules, and what each proposes. Any other country proposes nothing.",
  actions: [],
  response: z.object({ countries: z.array(pack) }),
  errors: [],
  example: {
    response: {
      countries: [
        {
          country: "IT",
          currency: "EUR",
          timeZone: "Europe/Rome",
          numberFormat: "it-IT",
          locale: "it",
          weekStart: 1,
          interestTaxPercent: "26",
        },
      ],
    },
  },
});

const onboardingBody = z.object({
  /** True while the first start is ahead of the person. */
  pending: z.boolean(),
  country,
  /** The instance's defaults, or null before the first admin chose them: then the browser proposes. */
  proposal: region.nullable(),
});

const ONBOARDING_EXAMPLE = { pending: false, country: "IT", proposal: REGION_EXAMPLE };

export const getOnboarding = defineRoute({
  id: "get_onboarding",
  method: "GET",
  path: "/onboarding",
  scope: "read",
  capability: "onboarding",
  summary: "Whether the first start is ahead of the person, their country, and what the instance proposes.",
  actions: [],
  response: onboardingBody,
  errors: [],
  example: { response: ONBOARDING_EXAMPLE },
});

export const completeOnboarding = defineRoute({
  id: "complete_onboarding",
  method: "POST",
  path: "/onboarding",
  scope: "write",
  capability: "onboarding",
  summary:
    "Ends the first start: country, format and addons. The first admin's choice becomes the instance's defaults.",
  actions: [],
  body: region.extend({ addons: z.array(z.enum(ADDONS)) }),
  response: onboardingBody,
  errors: ["invalid"],
  example: { body: { ...REGION_EXAMPLE, addons: ["budgets", "pockets"] }, response: ONBOARDING_EXAMPLE },
});

export const setCountry = defineRoute({
  id: "set_country",
  method: "PUT",
  path: "/country",
  scope: "write",
  capability: "onboarding",
  summary: "Changes the person's country; the format they chose stays.",
  actions: [],
  body: z.object({ country }),
  response: z.object({ country }),
  errors: ["invalid"],
  example: { body: { country: "FR" }, response: { country: "FR" } },
});

export const getInstanceDefaults = defineRoute({
  id: "get_instance_defaults",
  method: "GET",
  path: "/server/defaults",
  scope: "admin",
  capability: "onboarding",
  summary:
    "The instance's defaults, which a person signed up later starts from; null before any were chosen.",
  actions: [],
  response: z.object({ defaults: region.nullable() }),
  errors: [],
  example: { response: { defaults: REGION_EXAMPLE } },
});

export const saveInstanceDefaults = defineRoute({
  id: "save_instance_defaults",
  method: "PUT",
  path: "/server/defaults",
  scope: "admin",
  capability: "onboarding",
  summary: "Sets the instance's defaults.",
  actions: [],
  body: region,
  response: z.object({ defaults: region.nullable() }),
  errors: ["invalid"],
  example: { body: REGION_EXAMPLE, response: { defaults: REGION_EXAMPLE } },
});
