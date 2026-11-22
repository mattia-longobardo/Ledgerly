// Users and settings · the board of Expenses › Categories (categories-and-rules.md §5.2, §5.3): the
// three macros of a period with their groups and categories, as `macroViews` places them, and what
// the board draws on each line. Signs are the domain's: `total` signed, `in` and `out` positive.
import { z } from "zod";
import { defineRoute } from "../route";
import { BUDGET_STATUSES } from "../budgets/shared";
import { civilDate, hexColor, id, money } from "../primitives";
import { transactionFilters } from "../transactions/shared";
import { CATEGORY_ID, categoryType } from "./shared";

const amount = {
  count: z.number().int(),
  total: money(),
  in: money(),
  out: money(),
};

const line = z.object({
  id: id(),
  name: z.string(),
  parentId: id().nullable(),
  type: categoryType,
  /** The colour it is drawn in: its own or its group's, else the palette's (`colorOfCategory`). */
  color: hexColor(),
  /** The colour the person chose; null when none. */
  chosenColor: hexColor().nullable(),
  archived: z.boolean(),
  /** False for a category a source gave: it cannot be merged. */
  canMerge: z.boolean(),
  /** How many movements point at it, ever. */
  usage: z.number().int(),
  ...amount,
  /** Percentage of the macro, 0-100 with one decimal; 0 under Transfers. */
  share: z.number(),
  /** Its budget on every account in the period's last month; null without one. */
  budget: z.object({ limit: money(), status: z.enum(BUDGET_STATUSES) }).nullable(),
  /** The source whose categories count under it: its id, its name, and their names. */
  source: z.object({ provider: z.string(), name: z.string(), names: z.array(z.string()) }).nullable(),
});

const LINE_EXAMPLE = {
  id: CATEGORY_ID,
  name: "Groceries",
  parentId: null,
  type: "expense",
  color: "#3366cc",
  chosenColor: "#3366cc",
  archived: false,
  canMerge: true,
  usage: 42,
  count: 3,
  total: "-120.00",
  in: "0.00",
  out: "120.00",
  share: 100,
  budget: { limit: "300.00", status: "on_track" },
  source: null,
} as const;

export const getCategoriesBoard = defineRoute({
  id: "get_categories_board",
  method: "GET",
  path: "/categories/board",
  scope: "read",
  capability: "categories",
  summary:
    "Expenses › Categories in a period: Income, Expenses and Transfers with their totals, their groups " +
    "(the movements on the group itself in `only`) and categories, the biggest first, and the movements " +
    "without a category in `rest`.",
  actions: [],
  query: transactionFilters
    .pick({ accounts: true })
    .extend({ from: civilDate("Not a civil date"), to: civilDate("Not a civil date") }),
  response: z.object({
    macros: z.array(
      z.object({
        macro: categoryType,
        ...amount,
        groups: z.array(
          line.extend({
            /** The movements filed on the group itself; null when none. */
            only: z.object({ total: money(), count: z.number().int() }).nullable(),
            children: z.array(line),
          }),
        ),
        /** Income and Expenses: to categorise. Transfers: between your accounts. Null when none. */
        rest: z.object(amount).nullable(),
      }),
    ),
  }),
  errors: ["invalid"],
  example: {
    query: { from: "2026-10-01", to: "2026-10-31" },
    response: {
      macros: [
        {
          macro: "expense",
          count: 4,
          total: "-127.00",
          in: "0.00",
          out: "127.00",
          groups: [{ ...LINE_EXAMPLE, only: null, children: [] }],
          rest: { count: 1, total: "-7.00", in: "0.00", out: "7.00" },
        },
      ],
    },
  },
});

const mergeSide = z.object({
  id: id(),
  name: z.string(),
  /** The colour it is drawn in (`colorOfCategory`). */
  color: hexColor(),
  /** How many movements point at it, ever. */
  usage: z.number().int(),
  /** It has sub-categories: it can only stay under a group. */
  hasChildren: z.boolean(),
  /** It can keep the other side: false when the other has sub-categories and this one is a sub-category. */
  canKeepOther: z.boolean(),
});

export const getMergeProposals = defineRoute({
  id: "get_merge_proposals",
  method: "GET",
  path: "/categories/merge-proposals",
  scope: "read",
  capability: "categories",
  summary:
    "Settings › Categories: the pairs of categories that look like the same one, each side with what the " +
    "dialog says before the merge, and whether the merge sums two budgets.",
  actions: [],
  response: z.object({
    proposals: z.array(z.object({ first: mergeSide, second: mergeSide, sumsBudgets: z.boolean() })),
  }),
  errors: [],
  example: {
    response: {
      proposals: [
        {
          first: {
            id: CATEGORY_ID,
            name: "Groceries",
            color: "#3366cc",
            usage: 42,
            hasChildren: false,
            canKeepOther: true,
          },
          second: {
            id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
            name: "Grocery",
            color: "#3366cc",
            usage: 3,
            hasChildren: false,
            canKeepOther: true,
          },
          sumsBudgets: false,
        },
      ],
    },
  },
});
