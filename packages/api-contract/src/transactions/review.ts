// Transactions · «To review» and the automatic categories (rewrite plan N3; ux/n3-categories-manual.md
// §2-§7): the reads of its page and the Server Actions of `categorize/actions.ts`. A page gets a state,
// a category, the code of a reason and what its sentence names — never a confidence or a model.
import { z } from "zod";
import { defineRoute } from "../route";
import { civilDate, id, money } from "../primitives";
import {
  ACCOUNT_ID,
  byTransaction,
  CATEGORY_ID,
  changed,
  changedWithUndo,
  MAX_REVIEW_SELECTION,
  OTHER_TRANSACTION_ID,
  selection,
  TRANSACTION_ERRORS,
  TRANSACTION_ID,
  UNDO_ID,
} from "./shared";

/** A movement waiting for a category, as the review shows it. */
const reviewRow = z.object({
  id: id(),
  text: z.string(),
  on: civilDate(),
  accountId: id(),
  amount: money(),
  suggestedCategoryId: id().nullable(),
  reason: z.string().nullable(),
  params: z.record(z.string(), z.string()).nullable(),
});

/** Movements with the same text and the same suggestion: one decision for all of them. */
const reviewGroup = z.object({
  id: z.string(),
  text: z.string(),
  count: z.number().int(),
  total: money(),
  suggestedCategoryId: id().nullable(),
  reason: z.string().nullable(),
  params: z.record(z.string(), z.string()).nullable(),
  rows: z.array(reviewRow),
});

const mergeCategory = z.object({
  id: id(),
  name: z.string(),
  type: z.string(),
  parentId: id().nullable(),
  fromSource: z.boolean(),
  usage: z.number().int(),
});

const REVIEW_ROW_EXAMPLE = {
  id: TRANSACTION_ID,
  text: "Corner shop",
  on: "2026-10-14",
  accountId: ACCOUNT_ID,
  amount: "-42.80",
  suggestedCategoryId: CATEGORY_ID,
  reason: "memory",
  params: { text: "Corner shop" },
};

const OTHER_CATEGORY_ID = "4d3c2b1a-0f9e-4d8c-9b7a-6e5d4c3b2a1f";

export const getReview = defineRoute({
  id: "get_review",
  method: "GET",
  path: "/transactions/review",
  scope: "read",
  capability: "transactions",
  summary:
    "«To review» for a range: the accounts whose movements take an automatic category, the groups and " +
    "the single movements waiting for one, the pairs of categories that look like the same one, and " +
    "whether the first pass is still running. Without `accounts`, every account that takes one.",
  actions: [],
  query: z.object({
    from: civilDate("Not a civil date").optional(),
    to: civilDate("Not a civil date").optional(),
    accounts: z
      .string()
      .max(4000)
      .transform((value) => value.split(","))
      .pipe(z.array(id()).max(200))
      .optional(),
  }),
  response: z.object({
    accountIds: z.array(id()),
    preparing: z.boolean(),
    suggested: z.array(reviewGroup),
    unsuggested: z.array(reviewGroup),
    singles: z.array(reviewRow),
    mergeProposals: z.array(z.object({ first: mergeCategory, second: mergeCategory })),
    /** The movements waiting, groups and single movements together, and their amount. */
    count: z.number().int(),
    total: money(),
    /** How the movements of the chosen accounts stand, over any date: the guided review's counts. */
    counts: z.object({
      categorised: z.number().int(),
      suggested: z.number().int(),
      open: z.number().int(),
    }),
  }),
  errors: ["invalid"],
  example: {
    query: { from: "2026-10-01", to: "2026-10-31" },
    response: {
      accountIds: [ACCOUNT_ID],
      preparing: false,
      suggested: [],
      unsuggested: [],
      singles: [REVIEW_ROW_EXAMPLE],
      mergeProposals: [],
      count: 1,
      total: "-42.80",
      counts: { categorised: 120, suggested: 0, open: 1 },
    },
  },
});

export const confirmCategories = defineRoute({
  id: "confirm_categories",
  method: "POST",
  path: "/transactions/categories/confirm",
  scope: "write",
  capability: "transactions",
  summary: "«Confirm»: an automatic category or a suggestion becomes the person's own choice. With «Undo».",
  actions: [],
  body: z.object({ ids: selection(MAX_REVIEW_SELECTION) }),
  response: changedWithUndo,
  errors: TRANSACTION_ERRORS,
  example: { body: { ids: [TRANSACTION_ID] }, response: { count: 1, undoId: UNDO_ID } },
});

export const chooseCategory = defineRoute({
  id: "choose_category",
  method: "POST",
  path: "/transactions/categories/choose",
  scope: "write",
  capability: "transactions",
  summary: "The category chosen for a group or for similar movements: all of them or none. With «Undo».",
  actions: [],
  body: z.object({ ids: selection(MAX_REVIEW_SELECTION), categoryId: id().nullable() }),
  response: changedWithUndo,
  errors: TRANSACTION_ERRORS,
  example: {
    body: { ids: [TRANSACTION_ID], categoryId: CATEGORY_ID },
    response: { count: 1, undoId: UNDO_ID },
  },
});

export const undoCategories = defineRoute({
  id: "undo_categories",
  method: "POST",
  path: "/transactions/categories/undo/{undoId}",
  scope: "write",
  capability: "transactions",
  summary: "«Undo» of a confirmation or a choice.",
  actions: [],
  params: z.object({ undoId: id() }),
  response: changed,
  errors: TRANSACTION_ERRORS,
  example: { params: { undoId: UNDO_ID }, response: { count: 1 } },
});

export const listSimilarMovements = defineRoute({
  id: "list_similar_movements",
  method: "GET",
  path: "/transactions/{id}/similar",
  scope: "read",
  capability: "transactions",
  summary:
    "The movements with the same text as this one that may take `categoryId` too (decision K3). Writes " +
    "nothing.",
  actions: [],
  params: byTransaction,
  query: z.object({ categoryId: id() }),
  response: z.object({
    text: z.string(),
    rows: z.array(
      z.object({
        id: id(),
        on: civilDate(),
        amount: money(),
        categoryId: id().nullable(),
        suggestedCategoryId: id().nullable(),
        automatic: z.boolean(),
      }),
    ),
  }),
  errors: ["invalid", "not_found"],
  example: {
    params: { id: TRANSACTION_ID },
    query: { categoryId: CATEGORY_ID },
    response: {
      text: "Corner shop",
      rows: [
        {
          id: OTHER_TRANSACTION_ID,
          on: "2026-09-14",
          amount: "-38.10",
          categoryId: null,
          suggestedCategoryId: CATEGORY_ID,
          automatic: false,
        },
      ],
    },
  },
});

const pair = z.object({ firstId: id(), secondId: id() });

export const dismissMergeProposal = defineRoute({
  id: "dismiss_merge_proposal",
  method: "POST",
  path: "/categories/merge-proposals/dismiss",
  scope: "write",
  capability: "transactions",
  summary: "«They are different»: the pair is not proposed again.",
  actions: [],
  body: pair,
  response: null,
  status: 204,
  errors: TRANSACTION_ERRORS,
  example: { body: { firstId: CATEGORY_ID, secondId: OTHER_CATEGORY_ID } },
});

export const restoreMergeProposal = defineRoute({
  id: "restore_merge_proposal",
  method: "POST",
  path: "/categories/merge-proposals/restore",
  scope: "write",
  capability: "transactions",
  summary: "«Undo» of «They are different».",
  actions: [],
  body: pair,
  response: null,
  status: 204,
  errors: TRANSACTION_ERRORS,
  example: { body: { firstId: CATEGORY_ID, secondId: OTHER_CATEGORY_ID } },
});

export const createDefaultGroups = defineRoute({
  id: "create_default_groups",
  method: "POST",
  path: "/categories/defaults",
  scope: "write",
  capability: "transactions",
  summary:
    "The default groups the person chose, in their language, then a pass of the cascade after the answer; " +
    "answers how many were made.",
  actions: [],
  body: z.object({ keys: z.array(z.string().max(40)).min(1).max(20) }),
  response: changed,
  status: 201,
  errors: TRANSACTION_ERRORS,
  example: { body: { keys: ["groceries"] }, response: { count: 1 } },
});
