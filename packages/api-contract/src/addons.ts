// The Addons (rewrite plan R5a, H52, 13-plugins-addons.md §13.3): the modules of the core a person
// may turn off. The base modules (Overview, Accounts, Expenses, Settings, connections, alerts,
// export) are not in this list, so they have no switch. «Work» is the group of Payroll and Time Off,
// not an addon of its own. Funds is an addon of its own until R5b merges it into Investments.
import { z } from "zod";
import { defineRoute } from "./route";

export const ADDONS = [
  "investments",
  "funds",
  "payroll",
  "timeoff",
  "budgets",
  "subscriptions",
  "pockets",
  "interests",
] as const;

export type AddonId = (typeof ADDONS)[number];

/** The group an addon is shown in; an addon without one stands alone. */
export const ADDON_GROUPS: Partial<Record<AddonId, "work">> = { payroll: "work", timeoff: "work" };

/** What another addon loses while this one is off (PA12): it stays on, without that part. */
export const ADDON_STOPS: Partial<Record<AddonId, ReadonlyArray<{ addon: AddonId; what: AddonPart }>>> = {
  payroll: [
    { addon: "timeoff", what: "payslip_balances" },
    { addon: "funds", what: "payroll_contributions" },
  ],
  interests: [{ addon: "pockets", what: "interest" }],
};

/** The parts of an addon another addon feeds. */
const ADDON_PARTS = ["payslip_balances", "payroll_contributions", "interest"] as const;
type AddonPart = (typeof ADDON_PARTS)[number];

const addon = z.object({
  id: z.enum(ADDONS),
  group: z.enum(["work"]).nullable(),
  active: z.boolean(),
  /** What the other addons lose while this one is off: shown before the person confirms. */
  stops: z.array(z.object({ addon: z.enum(ADDONS), what: z.enum(ADDON_PARTS) })),
});

const addonsBody = z.object({ addons: z.array(addon) });

const ADDONS_EXAMPLE = {
  addons: [
    {
      id: "payroll",
      group: "work",
      active: true,
      stops: [
        { addon: "timeoff", what: "payslip_balances" },
        { addon: "funds", what: "payroll_contributions" },
      ],
    },
    { id: "budgets", group: null, active: false, stops: [] },
  ],
};

export const getAddons = defineRoute({
  id: "get_addons",
  method: "GET",
  path: "/addons",
  scope: "read",
  capability: "addons",
  summary: "The addons of the person, which of them are on, and what turning one off stops elsewhere.",
  actions: [],
  response: addonsBody,
  errors: [],

  example: { response: ADDONS_EXAMPLE },
});

export const setAddon = defineRoute({
  id: "set_addon",
  method: "PUT",
  path: "/addons/{id}",
  scope: "write",
  capability: "addons",
  summary:
    "Turns one addon on or off. Its data stays; net worth and totals do not change. Answers every addon.",
  actions: [],
  params: z.object({ id: z.enum(ADDONS) }),
  body: z.object({ active: z.boolean() }),
  response: addonsBody,
  errors: ["invalid"],
  example: { params: { id: "budgets" }, body: { active: false }, response: ADDONS_EXAMPLE },
});
