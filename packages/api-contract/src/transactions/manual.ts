// Transactions · the manual movement (rewrite plan R2 and N3.1; 12-account-modes.md §12.2): the
// Server Actions of its dialog. An amount travels as a plain decimal (`amountInput`), its size only:
// `kind` gives the sign. Nothing comes back formatted: the client says the day and the amounts.
import { z } from "zod";
import { defineRoute } from "../route";
import { amountInput, civilDate, id, money } from "../primitives";
import { beforeOpening } from "../accounts/shared";
import {
  ACCOUNT_ID,
  byTransaction,
  CATEGORY_ID,
  MANUAL_KINDS,
  TRANSACTION_ERRORS,
  TRANSACTION_ID,
} from "./shared";

const ACCOUNT_MODES = ["manual", "two_way", "read_only"] as const;

const movement = z.object({
  kind: z.enum(MANUAL_KINDS),
  amount: amountInput(),
  on: civilDate(),
  accountId: id(),
  categoryId: id().nullable(),
  payee: z.string().max(255),
  note: z.string().max(2000),
  /**
   * PERS-733: a giroconto with this other account of the person's; `kind` still gives the sign, and
   * `categoryId` is ignored. On a manual account the other leg is written at once and paired.
   */
  transferAccountId: id().nullable().optional(),
});

const MOVEMENT_EXAMPLE = {
  kind: "expense",
  amount: "42.80",
  on: "2026-10-14",
  accountId: ACCOUNT_ID,
  categoryId: CATEGORY_ID,
  payee: "Corner shop",
  note: "",
};

/** `beforeOpening`: the manual movements of the account left before its first balance (PERS-678). */
const written = z.object({ id: id(), created: z.boolean(), on: civilDate(), accountId: id(), beforeOpening });
const WRITTEN_EXAMPLE = {
  id: TRANSACTION_ID,
  created: true,
  on: "2026-10-14",
  accountId: ACCOUNT_ID,
  beforeOpening: null,
};

export const getManualForm = defineRoute({
  id: "get_manual_form",
  method: "GET",
  path: "/transactions/manual/form",
  scope: "read",
  capability: "transactions",
  summary:
    "What the dialog of a manual movement offers: the accounts that take one, in the order of Accounts, " +
    "with the source a «read and write» account sends it to, and today where the person is.",
  actions: [],
  response: z.object({
    accounts: z.array(
      z.object({
        id: id(),
        name: z.string(),
        currency: z.string(),
        mode: z.enum(ACCOUNT_MODES),
        source: z.object({ name: z.string(), waiting: z.boolean() }).nullable(),
      }),
    ),
    today: civilDate(),
  }),
  errors: [],
  example: {
    response: {
      accounts: [{ id: ACCOUNT_ID, name: "Everyday account", currency: "EUR", mode: "manual", source: null }],
      today: "2026-10-14",
    },
  },
});

export const createManualMovement = defineRoute({
  id: "create_manual_movement",
  method: "POST",
  path: "/transactions/manual",
  scope: "write",
  capability: "transactions",
  summary:
    "Writes a manual movement. `key` is the dialog's own: a second request with it answers with the row " +
    "already written (`created: false`). `invalid` with `reason` `amount` or `future_date`; `conflict` " +
    "with `reason` `account_unavailable`.",
  actions: [],
  body: movement.extend({ key: id() }),
  response: written,
  status: 201,
  errors: TRANSACTION_ERRORS,
  example: { body: { ...MOVEMENT_EXAMPLE, key: TRANSACTION_ID }, response: WRITTEN_EXAMPLE },
});

export const updateManualMovement = defineRoute({
  id: "update_manual_movement",
  method: "PUT",
  path: "/transactions/manual/{id}",
  scope: "write",
  capability: "transactions",
  summary: "Changes a manual movement; a movement of a source is `conflict`, `reason` `not_manual`.",
  actions: [],
  params: byTransaction,
  body: movement,
  response: written,
  errors: TRANSACTION_ERRORS,
  example: {
    params: { id: TRANSACTION_ID },
    body: MOVEMENT_EXAMPLE,
    response: { ...WRITTEN_EXAMPLE, created: false },
  },
});

export const deleteManualMovement = defineRoute({
  id: "delete_manual_movement",
  method: "DELETE",
  path: "/transactions/manual/{id}",
  scope: "write",
  capability: "transactions",
  summary: "Deletes a manual movement and rebuilds its account's balance.",
  actions: [],
  params: byTransaction,
  response: null,
  status: 204,
  errors: TRANSACTION_ERRORS,
  example: { params: { id: TRANSACTION_ID } },
});

export const retryManualSend = defineRoute({
  id: "retry_manual_send",
  method: "POST",
  path: "/transactions/manual/{id}/send",
  scope: "write",
  capability: "transactions",
  summary:
    "«Retry sending» a manual movement its source did not take: the source is updated now. `sent` says " +
    "whether it went; why not is the connection's state.",
  actions: [],
  params: byTransaction,
  response: z.object({ sent: z.boolean() }),
  errors: TRANSACTION_ERRORS,
  example: { params: { id: TRANSACTION_ID }, response: { sent: true } },
});

export const previewManualMovement = defineRoute({
  id: "preview_manual_movement",
  method: "POST",
  path: "/transactions/manual/preview",
  scope: "read",
  capability: "transactions",
  summary:
    "Today's balance of the account before and after the movement being written, or the day of the " +
    "reading that keeps it unchanged (`opening` when it is the account's first balance); null when there is " +
    "nothing to say. Writes nothing.",
  actions: [],
  body: movement.pick({ kind: true, amount: true, on: true, accountId: true }).extend({
    editingId: id().optional(),
  }),
  response: z.object({
    preview: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("change"), account: z.string(), before: money(), after: money() }),
        /** `opening`: the reading is the account's first, and the movement falls before it (PERS-678). */
        z.object({
          kind: z.literal("unchanged"),
          account: z.string(),
          readingOn: civilDate(),
          opening: z.boolean(),
        }),
      ])
      .nullable(),
  }),
  errors: ["invalid"],
  example: {
    body: { kind: "expense", amount: "42.80", on: "2026-10-14", accountId: ACCOUNT_ID },
    response: { preview: { kind: "change", account: "Everyday account", before: "100.00", after: "57.20" } },
  },
});

export const suggestManualCategory = defineRoute({
  id: "suggest_manual_category",
  method: "POST",
  path: "/transactions/manual/suggestion",
  scope: "read",
  capability: "transactions",
  summary:
    "The category the cascade would give the movement being written, from what is already known; null " +
    "for none, and the three likeliest categories for the selector's top. Nothing is learnt or written.",
  actions: [],
  body: movement.pick({ kind: true, amount: true, accountId: true, payee: true, note: true }),
  response: z.object({
    categoryId: id().nullable(),
    /** PERS-634: the three likeliest categories of the movement's kind, for the selector's top. */
    top: z.array(id()).max(3),
  }),
  errors: ["invalid"],
  example: {
    body: { kind: "expense", amount: "42.80", accountId: ACCOUNT_ID, payee: "Corner shop", note: "" },
    response: { categoryId: CATEGORY_ID, top: [CATEGORY_ID] },
  },
});
