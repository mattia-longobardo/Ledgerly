// Transactions · the spending of a range (rewrite plan R2, 05-refactor.md §5.5 «transactions»; audit
// TRX-3, TRX-4): one aggregate read, `spending(filters, groupBy)`, for the cards of Expenses and of a
// category's page. `share` is computed once, by the server.
import { z } from "zod";
import { defineRoute } from "../route";
import { civilDate, hexColor, id, money } from "../primitives";
import { CATEGORY_ID, TRANSACTION_TYPES, transactionFilters } from "./shared";

export const SPENDING_GROUPS = ["category", "day", "month"] as const;

/**
 * One group of the range. By `category`: the category (null for «Uncategorised»), its group and its
 * share of the card. By `day` or `month`: the bucket, by category group. `amount` is the sum; `in`
 * and `out` its two signs.
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
  count: z.number().int(),
  amount: money(),
  in: money(),
  out: money(),
  /** Percentage of the card, one decimal, over the absolute values; null by `day` and `month`. */
  share: z.number().nullable(),
});

export const getSpending = defineRoute({
  id: "get_spending",
  method: "GET",
  path: "/transactions/spending",
  scope: "read",
  capability: "transactions",
  summary:
    "The movements of a filtered range summed by category, by day or by month, giroconti left out " +
    "unless `type` is `transfer`.",
  actions: [],
  query: transactionFilters.extend({ groupBy: z.enum(SPENDING_GROUPS) }),
  response: z.object({ groups: z.array(spendingGroup) }),
  errors: ["invalid"],
  mcp: {
    title: "Spending",
    description:
      "The movements of a range summed by category (with each one's share), by day or by month, as " +
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
          in: "0.00",
          out: "-42.80",
          share: 100,
        },
      ],
    },
  },
});
