// `list_funds` (rewrite plan R5b, 11-standardization.md §11.4): the pension funds as a read of
// Investments, which comprises them (§13.7). Read only, with no type (decision H12).
import { defineRoute } from "../route";
import { FUNDS_LIST_EXAMPLE, fundsList } from "./portfolio";

export const listFunds = defineRoute({
  id: "list_funds",
  method: "GET",
  path: "/investments/funds",
  scope: "read",
  capability: "investments",
  summary:
    "Every pension fund, open and archived, with its account, its value today in its currency and in the " +
    "display currency, its last valuation, and the money paid in and the gain since it started.",
  actions: [],
  response: fundsList,
  errors: [],
  mcp: {
    title: "Pension funds",
    description:
      "Every pension fund, open and archived, as GET /api/v1/investments/funds: its id (for get_fund), " +
      "the `accountId` that holds its value, its provider, its value today in its own `currency` and in " +
      "the display currency (`displayValue`), the day of its last valuation, and the money paid in and " +
      "the gain since it started. An archived fund has no value: it holds no money today. Amounts are " +
      "decimal strings. Read only.",
  },
  example: { response: FUNDS_LIST_EXAMPLE },
});
