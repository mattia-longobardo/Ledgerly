// Transactions · the spending of a range (rewrite plan R2, 05-refactor.md §5.5 «transactions»; audit
// TRX-3, TRX-4): one aggregate read, `spending(filters, groupBy)`, for the cards of Expenses and of a
// category's page. `share` is computed once, by the server.
import { z } from "zod";
import { defineRoute } from "../route";
import { civilDate, hexColor, id, money } from "../primitives";
import { CATEGORY_ID, TRANSACTION_TYPES, transactionFilters } from "./shared";

export const SPENDING_GROUPS = ["category", "macro", "day", "month"] as const;

/**
 * One group of the range. By `category` (the card, giroconti out): the category (null for
 * «Uncategorised»), its group and its share. By `macro`: the category and the movements' type, every
 * type in. By `day` or `month`: the bucket and the category group, for one `type` (expense when none),
 * spending and transfers out as positive amounts. `amount` is the sum; `in` and `out` its two signs.
 */
const spendingGroup = z.object({
  bucket: civilDate().nullable(),
  categoryId: id().nullable(),
  name: z.string().nullable(),
  color: hexColor().nullable(),
  parentId: id().nullable(),
  parentName: z.string().nullable(),
  parentColor: hexColor().nullable(),
  type: z.enum(TRANSACTION_TYPES).nullable(),
  /** Null by `day` and `month`. */
  count: z.number().int().nullable(),
  amount: money(),
  /** The two signs of `amount`, by `macro` only. */
  in: money().nullable(),
  out: money().nullable(),
  /** Percentage of the card, one decimal, over the absolute values; by `category` only. */
  share: z.number().nullable(),
  /**
   * Present only when the total left movements out: those in another currency with no exchange rate
   * for their day (D4), never counted 1:1. The money is then partial.
   */
  excludedCount: z.number().int().positive().optional(),
});

export const getSpending = defineRoute({
  id: "get_spending",
  method: "GET",
  path: "/transactions/spending",
  scope: "read",
  capability: "transactions",
  summary:
    "The movements of a filtered range summed by category (the card, with each one's share), by category " +
    "and type, by day or by month.",
  actions: [],
  query: transactionFilters.extend({ groupBy: z.enum(SPENDING_GROUPS) }),
  response: z.object({ groups: z.array(spendingGroup) }),
  errors: ["invalid"],
  mcp: {
    title: "Spending",
    description:
      "The movements of a range summed by category (with each one's share), by category and type, by day " +
      "or by month, as " +
      "GET /api/v1/transactions/spending. Takes the filters of list_transactions.",
  },
  example: {
    query: { from: "2026-10-01", to: "2026-10-31", groupBy: "category" },
    response: {
      groups: [
        {
          bucket: null,
          categoryId: CATEGORY_ID,
          name: "Groceries",
          color: "#3366cc",
          parentId: null,
          parentName: null,
          parentColor: null,
          type: "expense",
          count: 1,
          amount: "-42.80",
          in: null,
          out: null,
          share: 100,
        },
      ],
    },
  },
});

/**
 * One bar of the «By category» card: the category (null for «Uncategorised»), its own stored colour
 * (null when it has none: the client gives it the palette's, as the page does), the amount as a
 * positive value, `share` of the whole and `width` of the largest bar of its level, both 0-1.
 */
const breakdownBar = z.object({
  id: id().nullable(),
  name: z.string().nullable(),
  color: hexColor().nullable(),
  amount: money(),
  /** `amount` with its sign: negative for spending. */
  signedAmount: money(),
  share: z.number(),
  width: z.number(),
});

export const getSpendingBreakdown = defineRoute({
  id: "get_spending_breakdown",
  method: "GET",
  path: "/transactions/spending/breakdown",
  scope: "read",
  capability: "transactions",
  summary:
    "The «By category» card on two levels, as the page draws it: one bar per group of categories, the " +
    "biggest first, each with its sub-categories measured within it (what was filed on the group itself " +
    "is one of them, under the group's name). Giroconti out; `total` is what the bars add up to.",
  actions: [],
  query: transactionFilters,
  response: z.object({
    total: money(),
    groups: z.array(breakdownBar.extend({ children: z.array(breakdownBar) })),
  }),
  errors: ["invalid"],
  example: {
    query: { from: "2026-10-01", to: "2026-10-31" },
    response: {
      total: "42.80",
      groups: [
        {
          id: CATEGORY_ID,
          name: "Groceries",
          color: "#3366cc",
          amount: "42.80",
          signedAmount: "-42.80",
          share: 1,
          width: 1,
          children: [],
        },
      ],
    },
  },
});

export const getSpendingSeries = defineRoute({
  id: "get_spending_series",
  method: "GET",
  path: "/transactions/spending/series",
  scope: "read",
  capability: "transactions",
  summary:
    "The spending chart of a range: every day or month from `from` to `to` (today at the latest) with " +
    "its total, and one series per group of categories with a value for every bucket, the biggest " +
    "first. One `type` (spending when none), as `get_spending` by day or month.",
  actions: [],
  query: transactionFilters.extend({
    from: civilDate("Not a civil date"),
    to: civilDate("Not a civil date"),
    grain: z.enum(["day", "month"]),
  }),
  response: z.object({
    /** What the buckets add up to. */
    total: money(),
    buckets: z.array(z.object({ bucket: civilDate(), total: money() })),
    groups: z.array(
      z.object({
        id: id().nullable(),
        name: z.string().nullable(),
        color: hexColor().nullable(),
        total: money(),
        /** `total` as a share of the series' `total`, 0-1 (0 when the series is 0). */
        share: z.number(),
        values: z.array(money()),
      }),
    ),
  }),
  errors: ["invalid"],
  example: {
    query: { from: "2026-10-01", to: "2026-10-02", grain: "day" },
    response: {
      total: "42.80",
      buckets: [
        { bucket: "2026-10-01", total: "42.80" },
        { bucket: "2026-10-02", total: "0.00" },
      ],
      groups: [
        {
          id: CATEGORY_ID,
          name: "Groceries",
          color: "#3366cc",
          total: "42.80",
          share: 1,
          values: ["42.80", "0.00"],
        },
      ],
    },
  },
});
