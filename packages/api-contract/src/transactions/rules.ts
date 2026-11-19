// Transactions · the rules of the person (categories-and-rules.md §4): Settings › Rules and the
// Server Actions of `categorize/user-rules-actions.ts`. An amount of a condition is a decimal string,
// as every amount of the wire (spec §4.3): the domain keeps it in cents.
import { z } from "zod";
import { defineRoute } from "../route";
import { amountInput, civilDate, id, money } from "../primitives";
import {
  ACCOUNT_ID,
  CATEGORY_ID,
  changedWithUndo,
  LABEL_ID,
  TRANSACTION_ERRORS,
  TRANSACTION_ID,
  UNDO_ID,
} from "./shared";

// The vocabularies of `categorize/user-rules.ts`, held equal by `tools/contract.test.ts`.
export const TEXT_OPS = ["contains", "notContains", "equals", "startsWith"] as const;
export const COUNTERPARTY_OPS = ["contains", "equals"] as const;
export const AMOUNT_OPS = ["gt", "lt", "between", "equals"] as const;
export const DIRECTIONS = ["in", "out"] as const;
export const RULE_SOURCES = ["bank", "manual"] as const;
export const MAX_CONDITIONS = 8;

/** The conditions without an amount; `words` is what a text may be (an answer's draft may be empty). */
const plainConditions = (words: z.ZodString) =>
  [
    z.object({ field: z.literal("text"), op: z.enum(TEXT_OPS), value: words }),
    z.object({ field: z.literal("counterparty"), op: z.enum(COUNTERPARTY_OPS), value: words }),
    z.object({ field: z.literal("ownAccount") }),
    z.object({ field: z.literal("direction"), value: z.enum(DIRECTIONS) }),
    z.object({ field: z.literal("account"), accountIds: z.array(id()).min(1).max(50) }),
    z.object({ field: z.literal("source"), value: z.enum(RULE_SOURCES) }),
    z.object({ field: z.literal("currency"), value: z.string().regex(/^[A-Z]{3}$/) }),
  ] as const;

/** A condition as a caller sends it; the domain checks the rest (repeated fields, the limits). */
const conditionInput = z.discriminatedUnion("field", [
  ...plainConditions(z.string().trim().min(1).max(100)),
  z.object({
    field: z.literal("amount"),
    op: z.enum(AMOUNT_OPS),
    amount: amountInput(),
    toAmount: amountInput().optional(),
  }),
]);

/** A condition as an answer gives it: the amounts as the server writes them. */
const condition = z.discriminatedUnion("field", [
  ...plainConditions(z.string().max(100)),
  z.object({
    field: z.literal("amount"),
    op: z.enum(AMOUNT_OPS),
    amount: money(),
    toAmount: money().optional(),
  }),
]);

const ruleInput = z.object({
  name: z.string().trim().min(1).max(80),
  active: z.boolean().optional(),
  conditions: z.array(conditionInput).min(1).max(MAX_CONDITIONS),
  categoryId: id(),
  labelIds: z.array(id()).max(20).optional(),
  note: z.string().max(200).nullable().optional(),
});

const rule = z.object({
  id: id(),
  name: z.string(),
  position: z.number().int(),
  active: z.boolean(),
  conditions: z.array(condition),
  categoryId: id(),
  labelIds: z.array(id()),
  note: z.string().nullable(),
  /** The movements that carry the rule's category today. */
  count: z.number().int(),
  /** The rule's category is archived: the rule is off by itself. */
  categoryArchived: z.boolean(),
});

/** What a rule finds among the movements already here (§4.6). */
const preview = z.object({
  matched: z.number().int(),
  kept: z.number().int(),
  changes: z.number().int(),
  rows: z.array(z.object({ id: id(), on: civilDate(), payee: z.string().nullable(), amount: money() })),
  /** The movements that would leave or join Transfers; null when none. */
  retyped: z
    .object({
      count: z.number().int(),
      amount: money(),
      since: civilDate(),
      from: z.enum(["income", "expense"]).nullable(),
    })
    .nullable(),
});

const RULE_ID = "0e1f2a3b-4c5d-4e6f-8a7b-8c9d0e1f2a3b";
const CONDITIONS_EXAMPLE = [
  { field: "text", op: "contains", value: "corner shop" },
  { field: "amount", op: "lt", amount: "100.00" },
];
const RULE_INPUT_EXAMPLE = { name: "Corner shop", conditions: CONDITIONS_EXAMPLE, categoryId: CATEGORY_ID };
const RULE_EXAMPLE = {
  id: RULE_ID,
  name: "Corner shop",
  position: 0,
  active: true,
  conditions: CONDITIONS_EXAMPLE,
  categoryId: CATEGORY_ID,
  labelIds: [LABEL_ID],
  note: null,
  count: 12,
  categoryArchived: false,
};
const PREVIEW_EXAMPLE = {
  matched: 12,
  kept: 2,
  changes: 10,
  rows: [{ id: TRANSACTION_ID, on: "2026-10-14", payee: "Corner shop", amount: "-42.80" }],
  retyped: null,
};

const byRule = z.object({ id: id() });

export const listRules = defineRoute({
  id: "list_rules",
  method: "GET",
  path: "/rules",
  scope: "read",
  capability: "rules",
  summary:
    "The person's rules in their order, each with how many movements carry its category. With `category`, " +
    "only the rules that give that category.",
  actions: [],
  query: z.object({ category: id().optional() }),
  response: z.object({ rules: z.array(rule) }),
  errors: ["invalid"],
  example: { response: { rules: [RULE_EXAMPLE] } },
});

export const getRuleDraft = defineRoute({
  id: "get_rule_draft",
  method: "GET",
  path: "/rules/draft",
  scope: "read",
  capability: "rules",
  summary:
    "The editor filled from a movement (§4.7) or with a category chosen (§5.4); `draft: null` when " +
    "neither gives one.",
  actions: [],
  query: z.object({ from: id().optional(), category: id().optional() }),
  response: z.object({
    draft: z
      .object({ name: z.string(), conditions: z.array(condition), categoryId: id().nullable() })
      .nullable(),
  }),
  errors: ["invalid"],
  example: {
    query: { from: TRANSACTION_ID },
    response: {
      draft: {
        name: "Corner shop",
        conditions: [
          { field: "counterparty", op: "equals", value: "Corner shop" },
          { field: "account", accountIds: [ACCOUNT_ID] },
        ],
        categoryId: CATEGORY_ID,
      },
    },
  },
});

export const previewRule = defineRoute({
  id: "preview_rule",
  method: "POST",
  path: "/rules/preview",
  scope: "read",
  capability: "rules",
  summary:
    "The live preview of the editor: what the rule would change. `ruleId` leaves the rule being edited " +
    "out. A rule not valid yet is `invalid`. Writes nothing.",
  actions: ["previewRuleAction"],
  body: z.object({ rule: ruleInput, ruleId: id().nullable() }),
  response: preview,
  errors: TRANSACTION_ERRORS,
  example: { body: { rule: RULE_INPUT_EXAMPLE, ruleId: null }, response: PREVIEW_EXAMPLE },
});

export const previewSavedRule = defineRoute({
  id: "preview_saved_rule",
  method: "GET",
  path: "/rules/{id}/preview",
  scope: "read",
  capability: "rules",
  summary: "What «Apply to existing transactions» would change, and the rule's category.",
  actions: ["previewSavedRuleAction"],
  params: byRule,
  response: preview.extend({ categoryId: id() }),
  errors: ["invalid", "not_found"],
  example: { params: { id: RULE_ID }, response: { ...PREVIEW_EXAMPLE, categoryId: CATEGORY_ID } },
});

const saved = z.object({ id: id(), changes: z.number().int() });

export const createRule = defineRoute({
  id: "create_rule",
  method: "POST",
  path: "/rules",
  scope: "write",
  capability: "rules",
  summary:
    "A new rule; answers how many movements already here it would change. `conflict`, `reason` `limit`, " +
    "when the person has as many rules as allowed.",
  actions: ["saveRuleAction:create"],
  body: ruleInput,
  response: saved,
  status: 201,
  errors: TRANSACTION_ERRORS,
  example: { body: RULE_INPUT_EXAMPLE, response: { id: RULE_ID, changes: 10 } },
});

export const updateRule = defineRoute({
  id: "update_rule",
  method: "PUT",
  path: "/rules/{id}",
  scope: "write",
  capability: "rules",
  summary: "Changes a rule; answers how many movements already here it would change.",
  actions: ["saveRuleAction:update"],
  params: byRule,
  body: ruleInput,
  response: saved,
  errors: TRANSACTION_ERRORS,
  example: { params: { id: RULE_ID }, body: RULE_INPUT_EXAMPLE, response: { id: RULE_ID, changes: 10 } },
});

export const setRuleActive = defineRoute({
  id: "set_rule_active",
  method: "PUT",
  path: "/rules/{id}/active",
  scope: "write",
  capability: "rules",
  summary: "Turns a rule on or off.",
  actions: ["setRuleActiveAction"],
  params: byRule,
  body: z.object({ active: z.boolean() }),
  response: null,
  status: 204,
  errors: TRANSACTION_ERRORS,
  example: { params: { id: RULE_ID }, body: { active: false } },
});

export const deleteRule = defineRoute({
  id: "delete_rule",
  method: "DELETE",
  path: "/rules/{id}",
  scope: "write",
  capability: "rules",
  summary: "Deletes a rule; «Undo» (`restore_rule`) for 7 days.",
  actions: ["deleteRuleAction:delete"],
  params: byRule,
  response: null,
  status: 204,
  errors: TRANSACTION_ERRORS,
  example: { params: { id: RULE_ID } },
});

export const restoreRule = defineRoute({
  id: "restore_rule",
  method: "POST",
  path: "/rules/{id}/restore",
  scope: "write",
  capability: "rules",
  summary: "«Undo» of the deletion of a rule.",
  actions: ["deleteRuleAction:restore"],
  params: byRule,
  response: null,
  status: 204,
  errors: TRANSACTION_ERRORS,
  example: { params: { id: RULE_ID } },
});

export const reorderRules = defineRoute({
  id: "reorder_rules",
  method: "PUT",
  path: "/rules/order",
  scope: "write",
  capability: "rules",
  summary: "The rules in their new order: the first that matches wins.",
  actions: ["reorderRulesAction"],
  body: z.object({ ids: z.array(id()).max(500) }),
  response: null,
  status: 204,
  errors: TRANSACTION_ERRORS,
  example: { body: { ids: [RULE_ID] } },
});

export const applyRule = defineRoute({
  id: "apply_rule",
  method: "POST",
  path: "/rules/{id}/apply",
  scope: "write",
  capability: "rules",
  summary: "«Apply» to the movements already here (§4.6): all or nothing, with «Undo».",
  actions: ["applyRuleAction"],
  params: byRule,
  response: changedWithUndo,
  errors: TRANSACTION_ERRORS,
  example: { params: { id: RULE_ID }, response: { count: 10, undoId: UNDO_ID } },
});

export const undoRuleApply = defineRoute({
  id: "undo_rule_apply",
  method: "POST",
  path: "/rules/apply/undo/{undoId}",
  scope: "write",
  capability: "rules",
  summary: "«Undo» of an «Apply».",
  actions: ["undoRuleApplyAction"],
  params: z.object({ undoId: id() }),
  response: null,
  status: 204,
  errors: TRANSACTION_ERRORS,
  example: { params: { undoId: UNDO_ID } },
});
