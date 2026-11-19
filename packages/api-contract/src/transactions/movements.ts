// Transactions · the movements (rewrite plan R2, 05-refactor.md §5.5 «transactions»; spec §7.2).
// `GET /transactions` keeps the answer of F8 and is the MCP tool `list_transactions`, with the
// arguments that tool had; the rest are the Server Actions of Expenses and the reads of its page.
import { z } from "zod";
import { defineRoute } from "../route";
import { amountInput, civilDate, id, money } from "../primitives";
import {
  ACCOUNT_ID,
  byTransaction,
  CATEGORY_ID,
  changed,
  DEFAULT_TRANSACTIONS,
  LABEL_ID,
  MAX_SELECTION,
  selection,
  SUMMARY_EXAMPLE,
  TRANSACTION_ERRORS,
  TRANSACTION_ID,
  TRANSACTION_LINE_EXAMPLE,
  TRANSACTION_ROW_EXAMPLE,
  TRANSACTION_TYPES,
  transactionFilters,
  transactionLine,
  transactionPage,
  transactionRow,
  transactionsSummary,
  transactionsTotals,
  VISIBILITY_CHANGES,
} from "./shared";

/** The page size of the MCP tool when none is asked, and the largest (F8, `tools.ts`). */
const TOOL_DEFAULT = 50;
const TOOL_MAX = 500;
/** The longest payee or note a source takes (`WALLET_RECORD_TEXT_MAX`). */
const SOURCE_TEXT_MAX = 255;

export const listTransactions = defineRoute({
  id: "list_transactions",
  method: "GET",
  path: "/transactions",
  scope: "read",
  capability: "transactions",
  summary:
    "Movements filtered like Expenses, with the totals of the whole filtered range (not just the page). " +
    `Without \`limit\`, ${DEFAULT_TRANSACTIONS} rows.`,
  actions: [],
  query: transactionFilters.extend(transactionPage.shape),
  response: z.object({ transactions: z.array(transactionRow), summary: transactionsSummary }),
  errors: ["invalid"],
  mcp: {
    title: "Transactions",
    description:
      "Movements filtered by period, account, category, type and payee text, with the totals of the " +
      "whole filtered range (not just the page), as GET /api/v1/transactions. Paginate with offset.",
    arguments: {
      from: civilDate().optional().describe("First day included, YYYY-MM-DD."),
      to: civilDate().optional().describe("Last day included, YYYY-MM-DD."),
      account_id: id().optional().describe("Only this account, from list_accounts."),
      category_id: id().optional().describe("Only this category (a group includes its sub-categories)."),
      type: z.enum(TRANSACTION_TYPES).optional(),
      payee: z.string().trim().min(1).max(200).optional().describe("Text the payee contains."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(TOOL_MAX)
        .optional()
        .describe(`Page size (default ${TOOL_DEFAULT}).`),
      offset: z.number().int().min(0).optional(),
    },
  },
  example: {
    query: { from: "2026-10-01", to: "2026-10-31", type: "expense", limit: "50" },
    response: { transactions: [TRANSACTION_ROW_EXAMPLE], summary: SUMMARY_EXAMPLE },
  },
});

/** A month header of Expenses: the month of the whole filtered range, not the page's. */
const monthTotal = z.object({ month: civilDate(), count: z.number().int(), net: money() });

/** The counts behind the chips of the filter bar, each dimension without its own filter. */
const facets = z.object({
  accounts: z.array(z.object({ accountId: id(), count: z.number().int() })),
  categories: z.array(z.object({ categoryId: id().nullable(), count: z.number().int() })),
  types: z.array(z.object({ type: z.enum(TRANSACTION_TYPES), count: z.number().int() })),
});

export const FACETS_EXAMPLE = {
  accounts: [{ accountId: ACCOUNT_ID, count: 1 }],
  categories: [{ categoryId: CATEGORY_ID, count: 1 }],
  types: [{ type: "expense", count: 1 }],
};

export const getTransactionsView = defineRoute({
  id: "get_transactions_view",
  method: "GET",
  path: "/transactions/view",
  scope: "read",
  capability: "transactions",
  summary:
    "What Expenses draws for a filter: a page of rows, the month headers and the totals of the whole " +
    "range, the facets of the chips and the movements waiting for a category.",
  actions: [],
  query: transactionFilters.extend(transactionPage.shape),
  response: z.object({
    rows: z.array(transactionLine),
    months: z.array(monthTotal),
    summary: transactionsTotals,
    facets,
    /** The rows of the whole range for the list: `summary.count` unless hidden rows are shown. */
    listCount: z.number().int(),
    truncated: z.boolean(),
    /** Whether the person has any movement at all. */
    hasAny: z.boolean(),
    review: z.object({ count: z.number().int(), suggested: z.number().int(), amount: money() }),
  }),
  errors: ["invalid"],
  example: {
    query: { from: "2026-10-01", to: "2026-10-31" },
    response: {
      rows: [TRANSACTION_LINE_EXAMPLE],
      months: [{ month: "2026-10-01", count: 1, net: "-42.80" }],
      summary: { ...SUMMARY_EXAMPLE, transferCount: 0, unpairedTransferCount: 0 },
      facets: FACETS_EXAMPLE,
      listCount: 1,
      truncated: false,
      hasAny: true,
      review: { count: 0, suggested: 0, amount: "0.00" },
    },
  },
});

export const getTransactionFacets = defineRoute({
  id: "get_transaction_facets",
  method: "GET",
  path: "/transactions/facets",
  scope: "read",
  capability: "transactions",
  summary: "How many movements each account, category and type holds in a filtered range.",
  actions: [],
  query: transactionFilters,
  response: facets,
  errors: ["invalid"],
  example: { query: { from: "2026-10-01", to: "2026-10-31" }, response: FACETS_EXAMPLE },
});

export const getTransaction = defineRoute({
  id: "get_transaction",
  method: "GET",
  path: "/transactions/{id}",
  scope: "read",
  capability: "transactions",
  summary: "One movement, as the pages draw it. Another person's movement is `not_found`.",
  actions: [],
  params: byTransaction,
  response: transactionLine,
  errors: ["invalid", "not_found"],
  example: { params: { id: TRANSACTION_ID }, response: TRANSACTION_LINE_EXAMPLE },
});

export const updateTransaction = defineRoute({
  id: "update_transaction",
  method: "PATCH",
  path: "/transactions/{id}",
  scope: "write",
  capability: "transactions",
  summary:
    "The fields a person owns on a movement: its note (trimmed; empty is none) and its labels. Payee, " +
    "amount and date belong to the source (`conflict`, reason `provider_owned`).",
  actions: ["setTransactionNoteAction", "setTransactionLabelsAction"],
  params: byTransaction,
  body: z
    .object({ note: z.string().max(2000), labelIds: z.array(id()).max(50) })
    .partial()
    .refine((patch) => Object.keys(patch).length > 0),
  response: null,
  status: 204,
  errors: TRANSACTION_ERRORS,
  example: { params: { id: TRANSACTION_ID }, body: { labelIds: [LABEL_ID] } },
});

export const setTransactionsCategory = defineRoute({
  id: "set_transactions_category",
  method: "PUT",
  path: "/transactions/category",
  scope: "write",
  capability: "transactions",
  summary: "One category, or none, for a selection of movements; answers how many changed.",
  actions: ["setTransactionCategoryAction"],
  body: z.object({ ids: selection(MAX_SELECTION), categoryId: id().nullable() }),
  response: changed,
  errors: TRANSACTION_ERRORS,
  example: { body: { ids: [TRANSACTION_ID], categoryId: CATEGORY_ID }, response: { count: 1 } },
});

export const changeTransactionsVisibility = defineRoute({
  id: "change_transactions_visibility",
  method: "POST",
  path: "/transactions/visibility",
  scope: "write",
  capability: "transactions",
  summary:
    "Hides, restores or deletes for good (hidden rows only) a selection, with the balance of a manual " +
    "movement's account kept right. A synced row deleted is never imported again.",
  actions: [
    "changeVisibilityAction",
    "hideTransactionsAction",
    "restoreTransactionsAction",
    "deleteHiddenTransactionsAction",
  ],
  body: z.object({ ids: selection(MAX_SELECTION), change: z.enum(VISIBILITY_CHANGES) }),
  response: changed,
  errors: TRANSACTION_ERRORS,
  example: { body: { ids: [TRANSACTION_ID], change: "hide" }, response: { count: 1 } },
});

export const editAtSource = defineRoute({
  id: "edit_transaction_at_source",
  method: "PATCH",
  path: "/transactions/{id}/source",
  scope: "write",
  capability: "transactions",
  summary:
    "Type, amount, payee and note of a movement its source lets change: written there first, then here. " +
    "`conflict` with `reason` `not_linked` or `no_transfer_category`, or the source's own words when it " +
    "refused; `unavailable` with its words when it could not be reached.",
  actions: ["editWalletTransactionAction"],
  params: byTransaction,
  body: z.object({
    type: z.enum(TRANSACTION_TYPES),
    amount: amountInput(),
    payee: z.string().max(SOURCE_TEXT_MAX),
    note: z.string().max(SOURCE_TEXT_MAX),
  }),
  response: z.object({ state: z.enum(["saved", "unchanged"]) }),
  errors: [...TRANSACTION_ERRORS, "unavailable"],
  example: {
    params: { id: TRANSACTION_ID },
    body: { type: "expense", amount: "42.80", payee: "Corner shop", note: "" },
    response: { state: "saved" },
  },
});

export const searchPayees = defineRoute({
  id: "search_payees",
  method: "GET",
  path: "/payees",
  scope: "read",
  capability: "transactions",
  summary: "The payees whose name contains the text, with how many movements each has (the ⌘K palette).",
  actions: ["searchPayeesAction"],
  query: z.object({
    q: z.string().max(200),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }),
  response: z.object({ payees: z.array(z.object({ payee: z.string(), count: z.number().int() })) }),
  errors: ["invalid"],
  example: { query: { q: "shop" }, response: { payees: [{ payee: "Corner shop", count: 12 }] } },
});
