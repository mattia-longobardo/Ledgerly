// Users and settings · categories, labels and the categories of a source (rewrite plan R2,
// 05-refactor.md §5.5; spec §7.2; categories-and-rules.md §5.6). Every write answers what its
// «Undo» needs; an `undo` object goes back exactly as it came (the state before is held by the
// client, not stored: `undoMergeAction`).
import { z } from "zod";
import { defineRoute } from "../route";
import { civilDate, hexColor, id, instant, money } from "../primitives";
import { transactionFilters } from "../transactions/shared";
import { CATEGORY_ID, categoryType, TAXONOMY_ERRORS } from "./shared";

const category = z.object({
  id: id(),
  name: z.string(),
  /** The group; null for a group itself. */
  parentId: id().nullable(),
  type: categoryType,
  /** The colour the person chose; null draws the one derived from the id. */
  color: hexColor().nullable(),
  /** The colour it is drawn in: its own, its group's for a sub-category, or the one derived from the id. */
  displayColor: hexColor(),
  /** 0 for a group, 1 for a sub-category: the lists are in tree order. */
  depth: z.union([z.literal(0), z.literal(1)]),
  /** How many movements point at it. */
  usage: z.number().int(),
  archivedAt: instant().nullable(),
});

const GROUP_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const CATEGORY_EXAMPLE = {
  id: CATEGORY_ID,
  name: "Groceries",
  parentId: GROUP_ID,
  type: "expense",
  color: null,
  displayColor: "#2563eb",
  depth: 1,
  usage: 42,
  archivedAt: null,
};

const categoryInput = z
  .object({
    name: z.string().trim().min(1).max(60),
    /** The group; null for none. */
    parentId: id().nullable(),
    type: categoryType,
    color: hexColor().nullable(),
  })
  .strict();

/** What an «Undo» sends back, exactly as the write answered it. */
const undoToken = z.record(z.string(), z.unknown());

export const listCategories = defineRoute({
  id: "list_categories",
  method: "GET",
  path: "/categories",
  scope: "read",
  capability: "categories",
  summary: "The person's categories in tree order, with how many movements each has.",
  actions: [],
  query: z.object({ archived: z.enum(["true", "false"]).optional() }),
  response: z.object({ categories: z.array(category) }),
  errors: ["invalid"],
  mcp: {
    title: "Categories",
    description:
      "The user's categories as GET /api/v1/categories: groups and sub-categories in tree order, the " +
      "macro each counts in (income, expense, transfer) and how many movements use it.",
  },
  example: { response: { categories: [CATEGORY_EXAMPLE] } },
});

export const createCategory = defineRoute({
  id: "create_category",
  method: "POST",
  path: "/categories",
  scope: "write",
  capability: "categories",
  summary: "Creates a category or a group.",
  actions: [],
  body: categoryInput,
  response: category,
  status: 201,
  errors: TAXONOMY_ERRORS,
  example: {
    body: { name: "Groceries", parentId: GROUP_ID, type: "expense", color: null },
    response: { ...CATEGORY_EXAMPLE, usage: 0 },
  },
});

export const updateCategory = defineRoute({
  id: "update_category",
  method: "PATCH",
  path: "/categories/{id}",
  scope: "write",
  capability: "categories",
  summary: "Changes a category's name, group or colour.",
  actions: [],
  params: z.object({ id: id() }),
  body: categoryInput,
  response: category,
  errors: TAXONOMY_ERRORS,
  example: {
    params: { id: CATEGORY_ID },
    body: { name: "Food", parentId: GROUP_ID, type: "expense", color: null },
    response: { ...CATEGORY_EXAMPLE, name: "Food" },
  },
});

export const archiveCategory = defineRoute({
  id: "archive_category",
  method: "POST",
  path: "/categories/{id}/archive",
  scope: "write",
  capability: "categories",
  summary: "Archives a category, with the sub-categories of a group. `ids` is what «Undo» restores.",
  actions: [],
  params: z.object({ id: id() }),
  response: z.object({ ids: z.array(id()) }),
  errors: TAXONOMY_ERRORS,
  example: { params: { id: CATEGORY_ID }, response: { ids: [CATEGORY_ID] } },
});

export const restoreCategories = defineRoute({
  id: "restore_categories",
  method: "POST",
  path: "/categories/restore",
  scope: "write",
  capability: "categories",
  summary: "Brings archived categories back: one, or every one an archive put away.",
  actions: [],
  body: z.object({ ids: z.array(id()).min(1) }).strict(),
  response: null,
  status: 204,
  errors: TAXONOMY_ERRORS,
  example: { body: { ids: [CATEGORY_ID] } },
});

export const moveCategory = defineRoute({
  id: "move_category",
  method: "POST",
  path: "/categories/{id}/move",
  scope: "write",
  capability: "categories",
  summary: "Moves a category to another group of the same macro. `fromId` is the group it left.",
  actions: [],
  params: z.object({ id: id() }),
  body: z.object({ parentId: id() }).strict(),
  response: z.object({ fromId: id() }),
  errors: TAXONOMY_ERRORS,
  example: { params: { id: CATEGORY_ID }, body: { parentId: GROUP_ID }, response: { fromId: GROUP_ID } },
});

export const deleteCategory = defineRoute({
  id: "delete_category",
  method: "DELETE",
  path: "/categories/{id}",
  scope: "write",
  capability: "categories",
  summary:
    "Deletes a category for good, and at the source it came from. `external` says what the source did.",
  actions: [],
  params: z.object({ id: id() }),
  response: z.object({
    removed: z.number().int(),
    /** Movements left without a category. */
    uncategorised: z.number().int(),
    external: z.discriminatedUnion("state", [
      z.object({ state: z.literal("not_linked") }),
      z.object({ state: z.literal("deleted"), count: z.number().int() }),
      z.object({ state: z.literal("refused"), reasons: z.array(z.string()) }),
      z.object({ state: z.literal("failed"), reason: z.string() }),
    ]),
  }),
  errors: TAXONOMY_ERRORS,
  example: {
    params: { id: CATEGORY_ID },
    response: { removed: 1, uncategorised: 42, external: { state: "not_linked" } },
  },
});

export const mergeCategories = defineRoute({
  id: "merge_categories",
  method: "POST",
  path: "/categories/merge",
  scope: "write",
  capability: "categories",
  summary: "Merges two categories: movements, sub-categories and budget limits of `dropId` go to `keepId`.",
  actions: [],
  body: z.object({ keepId: id(), dropId: id() }).strict(),
  response: z.object({ moved: z.number().int(), undo: undoToken }),
  errors: ["invalid", "conflict"],
  example: {
    body: { keepId: CATEGORY_ID, dropId: GROUP_ID },
    response: { moved: 12, undo: { keepId: CATEGORY_ID } },
  },
});

export const undoMerge = defineRoute({
  id: "undo_merge",
  method: "POST",
  path: "/categories/merge/undo",
  scope: "write",
  capability: "categories",
  summary: "Undoes a merge with the `undo` the merge answered.",
  actions: [],
  body: z.object({ undo: undoToken }).strict(),
  response: z.object({ moved: z.number().int() }),
  errors: ["invalid", "conflict"],
  example: { body: { undo: { keepId: CATEGORY_ID } }, response: { moved: 12 } },
});

const macroPlace = z.object({ type: categoryType, parentId: id().nullable() }).strict();

export const getMacroMove = defineRoute({
  id: "get_macro_move",
  method: "GET",
  path: "/categories/{id}/macro-move",
  scope: "read",
  capability: "categories",
  summary: "What moving a group to another macro changes, before the move: movements, total, linked records.",
  actions: [],
  params: z.object({ id: id() }),
  response: z.object({
    from: categoryType,
    count: z.number().int(),
    /** The total of the movements that stop counting in `from`, absolute, in the display currency. */
    amount: money(),
    currency: z.string().length(3),
    firstYear: z.number().int().nullable(),
    linked: z.object({
      subscriptions: z.number().int(),
      pockets: z.number().int(),
      interests: z.number().int(),
    }),
    stopsBudget: z.boolean(),
    sources: z.array(z.string()),
  }),
  errors: TAXONOMY_ERRORS,
  example: {
    params: { id: GROUP_ID },
    response: {
      from: "expense",
      count: 42,
      amount: "1234.56",
      currency: "EUR",
      firstYear: 2025,
      linked: { subscriptions: 0, pockets: 0, interests: 0 },
      stopsBudget: false,
      sources: [],
    },
  },
});

/**
 * The figures of one category's page (categories-and-rules.md §5.4) for a period, the category and
 * its sub-categories together. `amount` is what the page's KPI says: spent for an expense, received
 * for an income, moved out for a transfer, each positive when the money went that way. A child's
 * `amount` is its total with its sign, as the page's list shows it.
 */
export const getCategorySummary = defineRoute({
  id: "get_category_summary",
  method: "GET",
  path: "/categories/{id}/summary",
  scope: "read",
  capability: "categories",
  summary:
    "What a category spent, received or moved in a period with its sub-categories: the amount and the " +
    "movements, against the period before, by month, against its budget, its sub-categories and the source " +
    "whose categories count under it.",
  actions: [],
  params: z.object({ id: id() }),
  query: transactionFilters
    .pick({ accounts: true })
    .extend({ from: civilDate("Not a civil date"), to: civilDate("Not a civil date") }),
  response: z.object({
    amount: money(),
    count: z.number().int(),
    /** The amount of the period before, of the same length; null when it had no movement. */
    previousAmount: money().nullable(),
    /** `(amount - previousAmount) / previousAmount`; null without movements before or at 0. */
    change: z.number().nullable(),
    /** `amount` over the months the period has happened through; null under two months. */
    perMonth: money().nullable(),
    /** The budget of an expense category in the period's last month; null without one. */
    budget: z
      .object({
        limit: money(),
        /** The months of the period over the limit, the last one included. */
        overMonths: z.number().int(),
      })
      .nullable(),
    /** A group's sub-categories with their totals in the period, the biggest first; empty otherwise. */
    children: z.array(
      z.object({
        id: id(),
        name: z.string(),
        /** The stored colour; null draws the palette's. */
        color: hexColor().nullable(),
        amount: money(),
        /** Share of the macro in the period, 0-1; 0 under Transfers. */
        share: z.number(),
      }),
    ),
    /** The source whose categories count under this one: its id, its name, and their names. */
    source: z.object({ provider: z.string(), name: z.string(), names: z.array(z.string()) }).nullable(),
  }),
  errors: TAXONOMY_ERRORS,
  example: {
    params: { id: GROUP_ID },
    query: { from: "2026-09-01", to: "2026-10-31" },
    response: {
      amount: "600.00",
      count: 2,
      previousAmount: null,
      change: null,
      perMonth: "300.00",
      budget: { limit: "500.00", overMonths: 1 },
      children: [{ id: CATEGORY_ID, name: "Rent", color: null, amount: "-500.00", share: 0.833 }],
      source: null,
    },
  },
});

export const moveToMacro = defineRoute({
  id: "move_to_macro",
  method: "POST",
  path: "/categories/{id}/macro-move",
  scope: "write",
  capability: "categories",
  summary:
    "Moves a group, or a category of Transfers, to another macro. The numbers change; `undo` takes it back.",
  actions: [],
  params: z.object({ id: id() }),
  body: macroPlace,
  response: z.object({ undo: undoToken }),
  errors: TAXONOMY_ERRORS,
  example: {
    params: { id: GROUP_ID },
    body: { type: "transfer", parentId: null },
    response: { undo: { id: GROUP_ID } },
  },
});

export const undoMoveToMacro = defineRoute({
  id: "undo_move_to_macro",
  method: "POST",
  path: "/categories/macro-move/undo",
  scope: "write",
  capability: "categories",
  summary: "Undoes a move to another macro with the `undo` the move answered.",
  actions: [],
  body: z.object({ undo: undoToken }).strict(),
  response: null,
  status: 204,
  errors: TAXONOMY_ERRORS,
  example: { body: { undo: { id: GROUP_ID } } },
});
