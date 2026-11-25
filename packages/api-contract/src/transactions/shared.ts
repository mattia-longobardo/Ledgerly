// What the descriptors of transactions share (rewrite plan R2, 05-refactor.md §5.5 «transactions»):
// the vocabularies of the wire, the schema of the filters and one DTO per resource, used by the REST
// route, by its MCP tool and by the page alike (audit TRX-5, TRX-10, API-2). No route is declared here.
import { z } from "zod";
import { civilDate, hexColor, id, instant, money } from "../primitives";
import { categoryType } from "../settings/shared";

// The vocabularies are the domain's (`@ledgerly/domain/transactions`): the contract imports zod only
// (10-modularity.md §10.2), so `tools/contract.test.ts` holds the lists equal.
export const TRANSACTION_TYPES = ["income", "expense", "transfer"] as const;
export const TRANSACTION_STATES = ["cleared", "pending"] as const;
export const TRANSACTION_ORIGINS = ["provider", "manual"] as const;
export const SEND_STATES = ["to_send", "not_sent"] as const;
export const CATEGORY_STATES = ["chosen", "automatic", "suggestion", "none"] as const;
/** The markers of a row (spec §7.2), in the order the row shows them. */
export const ROW_BADGES = [
  "manual",
  "hidden",
  "removedUpstream",
  "edited",
  "transfer",
  "unpaired",
  "pending",
] as const;
export const MANUAL_KINDS = ["expense", "income"] as const;
export const SORT_KEYS = ["date", "amount", "payee", "account", "category"] as const;
export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export const VISIBILITY_CHANGES = ["hide", "restore", "delete"] as const;

/** The page size of `GET /transactions` when none is asked, and the largest (F8, `queries.ts`). */
export const DEFAULT_TRANSACTIONS = 500;
export const MAX_TRANSACTIONS = 2000;
/** The most movements one write of a selection takes (the Server Actions' bound). */
export const MAX_SELECTION = 500;
/** The most movements one choice of «To review» takes (`categorize/actions.ts`). */
export const MAX_REVIEW_SELECTION = 5000;

/**
 * A refusal of the transactions' use cases (`TransactionError`): `invalid` (`reason` `invalid`,
 * `invalid_reference`, `future_date`), `conflict` (`reason` `provider_owned`, `not_manual`,
 * `account_unavailable`, `limit`), `not_found`.
 */
export const TRANSACTION_ERRORS = ["invalid", "not_found", "conflict"] as const;

export const TRANSACTION_ID = "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";
export const OTHER_TRANSACTION_ID = "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e";
export const ACCOUNT_ID = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";
export const CATEGORY_ID = "3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a9f";
export const LABEL_ID = "8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f";
export const UNDO_ID = "9d0e1f2a-3b4c-4d5e-9f6a-7b8c9d0e1f2a";
export const byTransaction = z.object({ id: id() });

const csv = <T extends z.ZodType<unknown, string>>(item: T) =>
  z
    .string()
    .max(4000)
    .transform((value) => value.split(","))
    .pipe(z.array(item).max(200));

/**
 * The filters of Expenses as the query of a read (TRX-10: one schema for REST, MCP and the page).
 * `account` and `type` keep the single value of F8; `accounts`, `categories`, `labels` and `types`
 * are lists separated by commas. In `categories`, `none` is the «Uncategorised» chip.
 */
export const transactionFilters = z.object({
  from: civilDate("Not a civil date").optional(),
  to: civilDate("Not a civil date").optional(),
  account: id().optional(),
  accounts: csv(id()).optional(),
  category: id().optional(),
  categories: csv(z.union([id(), z.literal("none")])).optional(),
  labels: csv(id()).optional(),
  type: z.enum(TRANSACTION_TYPES).optional(),
  types: csv(z.enum(TRANSACTION_TYPES)).optional(),
  payee: z.string().trim().min(1).max(200).optional(),
  hidden: z.enum(["true", "false"]).optional(),
});

/** The order and the page of a list. */
export const transactionPage = z.object({
  sort: z.enum(SORT_KEYS).optional(),
  direction: z.enum(SORT_DIRECTIONS).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_TRANSACTIONS).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/** A movement as `GET /transactions` and `list_transactions` list it, unchanged since F8. */
export const transactionRow = z.object({
  id: id(),
  on: civilDate(),
  occurredAt: instant(),
  /** `occurredAt` carries a real time of day. `false`: show `on` alone, never the time of `occurredAt`. */
  timeKnown: z.boolean(),
  accountId: id(),
  accountName: z.string().nullable(),
  amount: money(),
  currency: z.string(),
  type: z.enum(TRANSACTION_TYPES),
  state: z.enum(TRANSACTION_STATES),
  categoryId: id().nullable(),
  categoryName: z.string().nullable(),
  payee: z.string().nullable(),
  note: z.string().nullable(),
  /** The labels' names. */
  labels: z.array(z.string()),
  hidden: z.boolean(),
});

/**
 * A movement as the pages draw it: the row of F8 and what the table says about it. The same row,
 * grown: never a second mapper (TRX-5).
 */
export const transactionLine = transactionRow.extend({
  categoryColor: hexColor().nullable(),
  categoryState: z.enum(CATEGORY_STATES),
  /** Why the category is automatic or suggested: a code and what its sentence names. */
  categoryReason: z.object({ code: z.string(), params: z.record(z.string(), z.string()) }).nullable(),
  /** The cascade reads it: its source gives no category. */
  categoryIsOwn: z.boolean(),
  suggestedCategoryId: id().nullable(),
  labelIds: z.array(id()),
  transferGroupId: id().nullable(),
  origin: z.enum(TRANSACTION_ORIGINS),
  sendState: z.enum(SEND_STATES).nullable(),
  /** The name of the source a manual movement waits for; null when it waits for none. */
  sendSource: z.string().nullable(),
  /** Its source can change type, amount, payee and note (`PATCH /transactions/{id}/source`). */
  editableAtSource: z.boolean(),
  removedUpstream: z.boolean(),
  edited: z.boolean(),
  /**
   * The markers the page draws, decided by the server (`badgesOf`): «hidden» is the person's own
   * hiding only, «edited» leaves out a category chosen where the source gives none. `hidden` and
   * `edited` above keep their meaning, for the MCP tools.
   */
  badges: z.array(z.enum(ROW_BADGES)),
  /** The macros its category may be chosen in (`macrosFor`): a pair, `transfer` only; else by the sign. */
  macros: z.array(categoryType),
});

/**
 * The money of a filtered range: income and spending without the giroconti; `net` every movement
 * summed, giroconti included (F2.5, kept by D3).
 */
export const transactionsSummary = z.object({
  count: z.number().int(),
  income: money(),
  expense: money(),
  net: money(),
  /** Income less spending, giroconti out (D3): differs from `net` when a giroconto has no counterpart. */
  incomeLessExpense: money(),
  /**
   * Present only when the total left movements out: those in another currency with no exchange rate
   * for their day (D4), never counted 1:1. The money is then partial.
   */
  excludedCount: z.number().int().positive().optional(),
});

/** What the pages add to the summary: how many giroconti the totals leave out. */
export const transactionsTotals = transactionsSummary.extend({
  transferCount: z.number().int(),
  unpairedTransferCount: z.number().int(),
});

export const TRANSACTION_ROW_EXAMPLE = {
  id: TRANSACTION_ID,
  on: "2026-10-14",
  occurredAt: "2026-10-14T08:12:00.000Z",
  timeKnown: true,
  accountId: ACCOUNT_ID,
  accountName: "Everyday account",
  amount: "-42.80",
  currency: "EUR",
  type: "expense",
  state: "cleared",
  categoryId: CATEGORY_ID,
  categoryName: "Groceries",
  payee: "Corner shop",
  note: null,
  labels: ["Home"],
  hidden: false,
};

export const TRANSACTION_LINE_EXAMPLE = {
  ...TRANSACTION_ROW_EXAMPLE,
  categoryColor: "#3366cc",
  categoryState: "automatic",
  categoryReason: { code: "memory", params: { text: "Corner shop" } },
  categoryIsOwn: true,
  suggestedCategoryId: null,
  labelIds: [LABEL_ID],
  transferGroupId: null,
  origin: "provider",
  sendState: null,
  sendSource: null,
  editableAtSource: false,
  removedUpstream: false,
  edited: false,
  badges: [],
  macros: ["expense", "transfer"],
};

export const SUMMARY_EXAMPLE = {
  count: 1,
  income: "0.00",
  expense: "-42.80",
  net: "-42.80",
  incomeLessExpense: "-42.80",
};

/** A write over a selection: how many rows really changed, for the toast. */
export const changed = z.object({ count: z.number().int() });
/** A write with an «Undo»: the id to undo it by, null when nothing changed. */
export const changedWithUndo = changed.extend({ undoId: id().nullable() });
export const selection = (max: number) => z.array(id()).min(1).max(max);
