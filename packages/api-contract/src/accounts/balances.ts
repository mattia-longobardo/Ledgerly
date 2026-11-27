// Accounts · the recorded balances of an account (rewrite plan R2, 05-refactor.md §5.5; spec §7.1).
// The two routes of F8 keep their answers; the read has one default for REST and MCP (audit
// ACC-5, API-3), and an entry is changed or deleted only when a person wrote it (`manual`).
import { z } from "zod";
import { defineRoute } from "../route";
import { amountInput, civilDate, id, money } from "../primitives";
import {
  ACCOUNT_ERRORS,
  ACCOUNT_ID,
  BALANCE_ENTRY_EXAMPLE,
  balanceEntry,
  beforeOpening,
  delta,
  ENTRY_ID,
} from "./shared";

/** The most entries one read gives, and how many when the caller does not say. */
const MAX_BALANCES = 200;

const entryInput = z
  .object({
    on: civilDate(),
    balance: amountInput(),
    /** What was spendable that day; null or missing when unknown. */
    available: amountInput().nullable().optional(),
    note: z.string().max(200).nullable().optional(),
  })
  .strict();

const ENTRY_INPUT_EXAMPLE = { on: "2026-10-31", balance: "11302.40", available: null, note: null };

export const getAccountBalances = defineRoute({
  id: "get_account_balances",
  method: "GET",
  path: "/accounts/{id}/balances",
  scope: "read",
  capability: "accounts",
  summary: `The recorded balances of one account, newest first; \`limit\` 1-${MAX_BALANCES}, ${MAX_BALANCES} when missing or not a number.`,
  actions: [],
  params: z.object({ id: id() }),
  query: z.object({ limit: z.string().optional() }),
  response: z.object({
    balances: z.array(
      /** `change`: from the entry before it, in the account's currency (the oldest one ever: null). */
      balanceEntry.extend({ change: delta }),
    ),
  }),
  errors: ["invalid", "not_found"],
  mcp: {
    title: "Balance history",
    description:
      "The recorded balances of one account, newest first, as GET /api/v1/accounts/{id}/balances. " +
      "Take the account id from list_accounts.",
    arguments: {
      account_id: id().describe("The account's id, from list_accounts."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_BALANCES)
        .optional()
        .describe(`How many entries, newest first (default ${MAX_BALANCES}).`),
    },
    pathArguments: { id: "account_id" },
  },
  example: {
    params: { id: ACCOUNT_ID },
    query: { limit: "50" },
    response: {
      balances: [{ ...BALANCE_ENTRY_EXAMPLE, change: { amount: "-243.44", fraction: -0.0210849 } }],
    },
  },
});

export const recordAccountBalance = defineRoute({
  id: "record_account_balance",
  method: "POST",
  path: "/accounts/{id}/balances",
  scope: "write",
  capability: "accounts",
  summary:
    "Records the balance of a day, as the form does: a second reading of the same day replaces the first.",
  actions: [],
  params: z.object({ id: id() }),
  body: entryInput,
  response: z.object({
    id: id(),
    on: z.string(),
    balance: money(),
    source: z.string(),
  }),
  status: 201,
  errors: ACCOUNT_ERRORS,
  example: {
    params: { id: ACCOUNT_ID },
    body: ENTRY_INPUT_EXAMPLE,
    response: { id: ENTRY_ID, on: "2026-10-31", balance: "11302.40", source: "manual" },
  },
});

const byEntry = z.object({ id: id(), entryId: id() });

export const updateBalanceEntry = defineRoute({
  id: "update_balance_entry",
  method: "PUT",
  path: "/accounts/{id}/balances/{entryId}",
  scope: "write",
  capability: "accounts",
  summary:
    "Corrects a balance a person recorded; any other source is `conflict`. Moved earlier, it moves the " +
    "account's opening day back with it. `beforeOpening`: the manual movements left before the first balance.",
  actions: [],
  params: byEntry,
  body: entryInput,
  response: balanceEntry.extend({ beforeOpening }),
  errors: ACCOUNT_ERRORS,
  example: {
    params: { id: ACCOUNT_ID, entryId: ENTRY_ID },
    body: ENTRY_INPUT_EXAMPLE,
    response: { ...BALANCE_ENTRY_EXAMPLE, beforeOpening: null },
  },
});

export const deleteBalanceEntry = defineRoute({
  id: "delete_balance_entry",
  method: "DELETE",
  path: "/accounts/{id}/balances/{entryId}",
  scope: "write",
  capability: "accounts",
  summary: "Deletes a balance a person recorded.",
  actions: [],
  params: byEntry,
  response: null,
  status: 204,
  errors: ["invalid", "not_found"],
  example: { params: { id: ACCOUNT_ID, entryId: ENTRY_ID } },
});
