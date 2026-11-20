// Budgets (rewrite plan R2, 05-refactor.md §5.5 «budgets»; audit BUD-2): the month's budgets as
// `list_budgets` answers them, what the Budgets page, Overview's card and a budget's page draw, and
// the three writes of the page. `slug` is a budget's address: `<category|all>_<account|all>`.
import { z } from "zod";
import { defineRoute } from "../route";
import { amountInput, hexColor, id, money, monthStart } from "../primitives";
import {
  ACCOUNT_ID,
  alertSettings,
  BUDGET_ERRORS,
  BUDGET_LINE_EXAMPLE,
  BUDGET_ROW_EXAMPLE,
  BUDGET_SLUG,
  budgetLine,
  budgetMonth,
  budgetRow,
  byBudget,
  CATEGORY_ID,
  HISTORY_MONTHS,
  OVERVIEW_BUDGETS,
} from "./shared";

const byMonth = z.object({
  month: budgetMonth().optional().describe("YYYY-MM; the current month when omitted."),
});

export const listBudgets = defineRoute({
  id: "list_budgets",
  method: "GET",
  path: "/budgets",
  scope: "read",
  capability: "budgets",
  summary:
    "The budgets of one month with their limit, what was spent and the status, plus the totals and the " +
    "spending no budget covers, as the Budgets page shows them.",
  actions: [],
  query: byMonth,
  response: z.object({
    month: monthStart(),
    budgets: z.array(budgetRow),
    /** The limit of the budgets no other budget contains; spent counts each movement once. */
    totals: z.object({ limit: money(), spent: money() }),
    unbudgeted: money(),
  }),
  errors: ["invalid"],
  mcp: {
    title: "Budgets",
    description:
      "The budgets of one month with their limit, what was spent and the status, plus the totals " +
      "and the spending no budget covers, as the Budgets page shows them.",
  },
  example: {
    query: { month: "2026-10" },
    response: {
      month: "2026-10-01",
      budgets: [BUDGET_ROW_EXAMPLE],
      totals: { limit: "300.00", spent: "255.00" },
      unbudgeted: "40.00",
    },
  },
});

/** A choice of «Add budget»: an open spending category (a sub-category at depth 1) or an open account. */
const option = z.object({
  id: id(),
  name: z.string(),
  color: hexColor().nullable(),
  depth: z.union([z.literal(0), z.literal(1)]),
});

export const getBudgetsView = defineRoute({
  id: "get_budgets_view",
  method: "GET",
  path: "/budgets/view",
  scope: "read",
  capability: "budgets",
  summary:
    "The Budgets page of one month: the rows of `list_budgets` with what the page draws, the totals, the " +
    "spending waiting for a category, the choices of «Add budget» and the first month with a limit.",
  actions: [],
  query: byMonth,
  response: z.object({
    month: monthStart(),
    budgets: z.array(budgetLine),
    /** `percent` as a row's: spent as a whole percentage of the limit, rounded half-up. */
    totals: z.object({ limit: money(), spent: money(), remaining: money(), percent: z.number().int() }),
    unbudgeted: money(),
    /** The month's spending with no category yet: in no category budget until a person files it. */
    toCategorise: z.object({ count: z.number().int(), amount: money() }),
    categories: z.array(option),
    accounts: z.array(z.object({ id: id(), name: z.string() })),
    /** Where the month stepper stops going back; null with no limit ever set. */
    firstMonth: monthStart().nullable(),
  }),
  errors: ["invalid"],
  example: {
    query: { month: "2026-10-01" },
    response: {
      month: "2026-10-01",
      budgets: [BUDGET_LINE_EXAMPLE],
      totals: { limit: "300.00", spent: "255.00", remaining: "45.00", percent: 85 },
      unbudgeted: "40.00",
      toCategorise: { count: 2, amount: "18.40" },
      categories: [{ id: CATEGORY_ID, name: "Groceries", color: "#3366cc", depth: 0 }],
      accounts: [{ id: ACCOUNT_ID, name: "Checking" }],
      firstMonth: "2026-01-01",
    },
  },
});

export const getBudgetsOverview = defineRoute({
  id: "get_budgets_overview",
  method: "GET",
  path: "/budgets/overview",
  scope: "read",
  capability: "budgets",
  summary:
    "Overview's «Budgets» card: the budgets of the month closest to their limit, the highest `percent` " +
    `first, ${OVERVIEW_BUDGETS} at most.`,
  actions: [],
  query: byMonth,
  response: z.object({ month: monthStart(), budgets: z.array(budgetLine).max(OVERVIEW_BUDGETS) }),
  errors: ["invalid"],
  example: { response: { month: "2026-10-01", budgets: [BUDGET_LINE_EXAMPLE] } },
});

export const getBudget = defineRoute({
  id: "get_budget",
  method: "GET",
  path: "/budgets/{budget}",
  scope: "read",
  capability: "budgets",
  summary:
    `One budget's page: its row in \`month\`, the ${HISTORY_MONTHS} months before it (newest first, the ` +
    "limit null in a month without one) and its alerts. `not_found` when the budget has no limit in `month`.",
  actions: [],
  params: byBudget,
  query: byMonth,
  response: z.object({
    budget: budgetLine,
    history: z.array(
      z.object({
        month: monthStart(),
        limit: money().nullable(),
        spent: money(),
        /** As a row's `percent`; null in a month without a limit. */
        percent: z.number().int().nullable(),
        /** `limit - spent`, negative when over; null in a month without a limit. */
        remaining: money().nullable(),
      }),
    ),
    alerts: alertSettings,
  }),
  errors: ["invalid", "not_found"],
  example: {
    params: { budget: BUDGET_SLUG },
    query: { month: "2026-10" },
    response: {
      budget: BUDGET_LINE_EXAMPLE,
      history: [{ month: "2026-09-01", limit: "300.00", spent: "281.10", percent: 94, remaining: "18.90" }],
      alerts: { enabled: true, thresholds: [85, 100] },
    },
  },
});

export const setBudgetLimit = defineRoute({
  id: "set_budget_limit",
  method: "PUT",
  path: "/budgets/{budget}/limit",
  scope: "write",
  capability: "budgets",
  summary:
    "Sets the budget's limit from `month` onwards: versions already set for later months are replaced. " +
    "The amount is a positive decimal string.",
  actions: ["setBudgetLimitAction"],
  params: byBudget,
  body: z.object({ month: budgetMonth(), amount: amountInput() }),
  response: null,
  status: 204,
  errors: BUDGET_ERRORS,
  example: { params: { budget: BUDGET_SLUG }, body: { month: "2026-10", amount: "300" } },
});

export const stopBudget = defineRoute({
  id: "stop_budget",
  method: "POST",
  path: "/budgets/{budget}/stop",
  scope: "write",
  capability: "budgets",
  summary:
    "Takes the budget away from `month` onwards; the months before keep their limit. A budget stopped in " +
    "the month it began leaves nothing behind.",
  actions: ["stopBudgetAction"],
  params: byBudget,
  body: z.object({ month: budgetMonth() }),
  response: null,
  status: 204,
  errors: BUDGET_ERRORS,
  example: { params: { budget: BUDGET_SLUG }, body: { month: "2026-10" } },
});

export const saveBudgetAlerts = defineRoute({
  id: "save_budget_alerts",
  method: "PUT",
  path: "/budgets/{budget}/alerts",
  scope: "write",
  capability: "budgets",
  summary:
    "When the budget emails: on or off, and the percentages of its limit that send one (sorted, without " +
    "repeats, in the answer). Alerts on need a threshold.",
  actions: ["saveBudgetAlertsAction"],
  params: byBudget,
  body: alertSettings,
  response: alertSettings,
  errors: BUDGET_ERRORS,
  example: {
    params: { budget: BUDGET_SLUG },
    body: { enabled: true, thresholds: [100, 85] },
    response: { enabled: true, thresholds: [85, 100] },
  },
});
