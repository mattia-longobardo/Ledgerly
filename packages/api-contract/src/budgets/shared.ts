// What the descriptors of budgets share (rewrite plan R2, 05-refactor.md §5.5 «budgets»; audit BUD-2,
// BUD-8): the vocabularies of the wire, the one schema of a month and the row of a budget, used by the
// REST route, by its MCP tool and by the pages alike. No route is declared here.
import { z } from "zod";
import { hexColor, id, money } from "../primitives";

// The vocabularies are the domain's (`@ledgerly/domain/budgets`): the contract imports zod only
// (10-modularity.md §10.2), so `tools/contract.test.ts` holds the lists equal.
export const BUDGET_STATUSES = ["over", "near", "on_track"] as const;
/** The thresholds the alert form offers as one-click choices; any other whole percent may be typed. */
export const ALERT_PRESETS = [50, 75, 85, 90, 100] as const;
export const MAX_ALERT_THRESHOLDS = 8;
/** The lowest and highest percent of the limit an alert can be set at. */
export const MIN_ALERT_PERCENT = 1;
export const MAX_ALERT_PERCENT = 200;
/** How many budgets Overview's card shows. */
export const OVERVIEW_BUDGETS = 5;
/** The months before the chosen one that a budget's page shows. */
export const HISTORY_MONTHS = 6;

/**
 * A refusal of the budgets' use cases (`BudgetError`): `invalid` (a category that is not a spending
 * one, a budget on nothing), `not_found` (a category or an open account that is not the caller's).
 */
export const BUDGET_ERRORS = ["invalid", "not_found"] as const;

export const CATEGORY_ID = "3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a9f";
export const ACCOUNT_ID = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";
/** A budget's address on the wire: `<category|all>_<account|all>`, never `all_all`. */
export const BUDGET_SLUG = `${CATEGORY_ID}_all`;

/**
 * A month (audit BUD-8: one schema for REST, MCP and the pages): `YYYY-MM`, as `list_budgets` has
 * taken it since F8, or its first day, `YYYY-MM-01`, as every answer writes it. The route reads both
 * as the month's first day; none is the current month in the user's time zone.
 */
export const budgetMonth = () => z.string().regex(/^\d{4}-(0[1-9]|1[0-2])(-01)?$/, "A month as YYYY-MM");

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The path of one budget: its scope's two halves (`parseBudgetSlug` of the domain). */
export const byBudget = z.object({
  budget: z
    .string()
    .regex(new RegExp(`^(all|${UUID})_(all|${UUID})$`))
    .refine((slug) => slug !== "all_all", "A budget is on a category, an account or both"),
});

/**
 * One budget as `list_budgets` has answered since F8: the scope, the names, the limit in force, what
 * was spent and the status. `percent` is spent over limit, whole, rounded half up, past 100 when over.
 */
export const budgetRow = z.object({
  categoryId: id().nullable(),
  /** The category's name; null for a budget on a whole account. */
  category: z.string().nullable(),
  /** The group's name when the category is a sub-category. */
  group: z.string().nullable(),
  accountId: id().nullable(),
  account: z.string().nullable(),
  limit: money(),
  spent: money(),
  status: z.enum(BUDGET_STATUSES),
  percent: z.number().int(),
});

/**
 * The row the pages draw: the row of `list_budgets` and what the screen needs on top of it, computed
 * by the server (spec §8.5, R3: the client does no sums). One mapper gives both.
 */
export const budgetLine = budgetRow.extend({
  /** The budget's address, for its page and its writes. */
  slug: z.string(),
  /** «Group › Sub» for a sub-category shown on its own, the name otherwise; null for «All categories». */
  name: z.string().nullable(),
  /** The category's colour, or its group's for a sub-category; null with neither. */
  color: hexColor().nullable(),
  /** 1 when the budget of its group, on the same account, is shown right above it. */
  depth: z.union([z.literal(0), z.literal(1)]),
  /** `limit − spent`: negative when over. */
  remaining: money(),
});

/** What a budget emails: on or off, and the percentages of the limit that send one. */
export const alertSettings = z.object({
  enabled: z.boolean(),
  thresholds: z
    .array(z.number().int().min(MIN_ALERT_PERCENT).max(MAX_ALERT_PERCENT))
    .max(MAX_ALERT_THRESHOLDS),
});

export const BUDGET_ROW_EXAMPLE = {
  categoryId: CATEGORY_ID,
  category: "Groceries",
  group: null,
  accountId: null,
  account: null,
  limit: "300.00",
  spent: "255.00",
  status: "near",
  percent: 85,
};

export const BUDGET_LINE_EXAMPLE = {
  ...BUDGET_ROW_EXAMPLE,
  slug: BUDGET_SLUG,
  name: "Groceries",
  color: "#3366cc",
  depth: 0,
  remaining: "45.00",
};
