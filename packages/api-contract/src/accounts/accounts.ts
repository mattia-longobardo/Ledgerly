// Accounts · the accounts themselves (rewrite plan R2, 05-refactor.md §5.5 «accounts»; spec §7.1).
// `GET /accounts` keeps the answer of F8; the rest are the Server Actions of the module (R2
// criterion 4). An IBAN goes in and never comes back (H45): an answer says only whether there is one.
import { z } from "zod";
import { defineRoute } from "../route";
import { amountInput, civilDate, hexColor, id, instant, money } from "../primitives";
import {
  ACCOUNT_ERRORS,
  ACCOUNT_ID,
  ACCOUNT_ORIGINS,
  ACCOUNT_ROW_EXAMPLE,
  ACCOUNT_STATES,
  ACCOUNT_TYPES,
  accountRow,
  byAccount,
  REMINDERS,
  TRENDS,
} from "./shared";

/** One account with its settings: what the account's page and its settings form read. */
const accountDetail = z.object({
  id: id(),
  name: z.string(),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.string(),
  origin: z.enum(ACCOUNT_ORIGINS),
  /** The source of a synced account (`plugin:<id>` or a provider of the core); null when manual. */
  provider: z.string().nullable(),
  state: z.enum(ACCOUNT_STATES),
  color: hexColor().nullable(),
  reference: z.string().nullable(),
  /** Whether the account has an IBAN, and whether its source wrote it: never the IBAN (H45). */
  hasIban: z.boolean(),
  ibanFromSource: z.boolean(),
  purpose: z.string().nullable(),
  openedOn: z.string().nullable(),
  notes: z.string().nullable(),
  inNetWorth: z.boolean(),
  inSnapshot: z.boolean(),
  countsAsLiquid: z.boolean(),
  lowBalance: money().nullable(),
  staleAfterHours: z.number().int(),
  reminder: z.enum(REMINDERS),
  betweenEntries: z.enum(TRENDS),
  lastSyncedAt: instant().nullable(),
  archivedAt: instant().nullable(),
});

const ACCOUNT_DETAIL_EXAMPLE = {
  id: ACCOUNT_ID,
  name: "Everyday account",
  type: "checking",
  currency: "EUR",
  origin: "manual",
  provider: null,
  state: "active",
  color: "#3366cc",
  reference: null,
  hasIban: true,
  ibanFromSource: false,
  purpose: "Salary and bills",
  openedOn: "2019-03-01",
  notes: null,
  inNetWorth: true,
  inSnapshot: true,
  countsAsLiquid: true,
  lowBalance: "500.00",
  staleAfterHours: 36,
  reminder: "monthly",
  betweenEntries: "hold",
  lastSyncedAt: null,
  archivedAt: null,
};

const name = z.string().trim().min(1).max(80);
const text = (max: number) => z.string().max(max);

export const listAccounts = defineRoute({
  id: "list_accounts",
  method: "GET",
  path: "/accounts",
  scope: "read",
  capability: "accounts",
  summary: "Every account with its type, currency, state and today's balance.",
  actions: [],
  response: z.object({ accounts: z.array(accountRow) }),
  errors: [],
  mcp: {
    title: "Accounts",
    description: "Every account with its type, currency, state and today's balance, as GET /api/v1/accounts.",
  },
  example: { response: { accounts: [ACCOUNT_ROW_EXAMPLE] } },
});

export const getAccount = defineRoute({
  id: "get_account",
  method: "GET",
  path: "/accounts/{id}",
  scope: "read",
  capability: "accounts",
  summary: "One account with its settings. Another person's account is `not_found`.",
  actions: [],
  params: byAccount,
  response: accountDetail,
  errors: ["invalid", "not_found"],
  example: { params: { id: ACCOUNT_ID }, response: ACCOUNT_DETAIL_EXAMPLE },
});

export const createAccount = defineRoute({
  id: "create_account",
  method: "POST",
  path: "/accounts",
  scope: "write",
  capability: "accounts",
  summary: "Creates a manual account, with its opening balance when given.",
  actions: ["createAccountAction"],
  body: z
    .object({
      name,
      type: z.enum(ACCOUNT_TYPES),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .optional(),
      color: hexColor().nullable().optional(),
      reference: text(64).nullable().optional(),
      iban: text(64).nullable().optional(),
      purpose: text(120).nullable().optional(),
      openedOn: civilDate().nullable().optional(),
      notes: text(2000).nullable().optional(),
      openingBalance: z.object({ on: civilDate(), amount: amountInput() }).strict().nullable().optional(),
    })
    .strict(),
  response: accountDetail,
  status: 201,
  errors: ACCOUNT_ERRORS,
  example: {
    body: {
      name: "Everyday account",
      type: "checking",
      currency: "EUR",
      color: "#3366cc",
      iban: "IT60X0542811101000000123456",
      purpose: "Salary and bills",
      openedOn: "2019-03-01",
      openingBalance: { on: "2026-10-31", amount: "11302.40" },
    },
    response: { ...ACCOUNT_DETAIL_EXAMPLE, lowBalance: null, reminder: "never" },
  },
});

export const updateAccount = defineRoute({
  id: "update_account",
  method: "PATCH",
  path: "/accounts/{id}",
  scope: "write",
  capability: "accounts",
  summary:
    "Changes an account's settings: a field left out keeps its value, `iban: null` removes the IBAN. A synced account keeps its currency.",
  actions: ["saveAccountSettingsAction"],
  params: byAccount,
  body: z
    .object({
      name,
      type: z.enum(ACCOUNT_TYPES),
      currency: z.string().regex(/^[A-Z]{3}$/),
      color: hexColor().nullable(),
      reference: text(64).nullable(),
      iban: text(64).nullable(),
      purpose: text(120).nullable(),
      openedOn: civilDate().nullable(),
      notes: text(2000).nullable(),
      inNetWorth: z.boolean(),
      inSnapshot: z.boolean(),
      countsAsLiquid: z.boolean(),
      lowBalance: amountInput().nullable(),
      staleAfterHours: z.number().int().min(1).max(8760),
      reminder: z.enum(REMINDERS),
      betweenEntries: z.enum(TRENDS),
    })
    .partial()
    .strict(),
  response: accountDetail,
  errors: ACCOUNT_ERRORS,
  example: {
    params: { id: ACCOUNT_ID },
    body: { name: "Everyday account", lowBalance: "500.00", reminder: "monthly" },
    response: ACCOUNT_DETAIL_EXAMPLE,
  },
});

export const archiveAccount = defineRoute({
  id: "archive_account",
  method: "POST",
  path: "/accounts/{id}/archive",
  scope: "write",
  capability: "accounts",
  summary: "Archives an account: it keeps its history and leaves the lists. `restore` brings it back.",
  actions: ["archiveAccountAction"],
  params: byAccount,
  response: null,
  status: 204,
  errors: ACCOUNT_ERRORS,
  example: { params: { id: ACCOUNT_ID } },
});

export const restoreAccount = defineRoute({
  id: "restore_account",
  method: "POST",
  path: "/accounts/{id}/restore",
  scope: "write",
  capability: "accounts",
  summary: "Brings an archived account back.",
  actions: ["restoreAccountAction"],
  params: byAccount,
  response: null,
  status: 204,
  errors: ACCOUNT_ERRORS,
  example: { params: { id: ACCOUNT_ID } },
});
