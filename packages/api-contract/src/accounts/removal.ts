// Accounts · «Delete account» (rewrite plan R2, 05-refactor.md §5.5; 04-now.md §4.6): what rests on
// the account, its move to another account, and the deletion, which never archives. A refusal is
// `conflict` or `not_found` with the code of the dialog in `reason` (`invalid_account`,
// `not_synced`, `conflict`, `account_taken`, `same_account`, `in_use`).
import { z } from "zod";
import { defineRoute } from "../route";
import { id } from "../primitives";
import { ACCOUNT_ID, byAccount, OTHER_ACCOUNT_ID } from "./shared";

const DEPENDENT_KINDS = [
  "pocket",
  "interestRule",
  "budgetLimit",
  "subscription",
  "fund",
  "fundSource",
] as const;
const REMOVAL_ERRORS = ["invalid", "not_found", "conflict"] as const;

const dependent = z.object({
  kind: z.enum(DEPENDENT_KINDS),
  /** A budget limit's id is its category, `""` for a limit on the account alone. */
  id: z.union([id(), z.literal("")]),
  label: z.string().nullable(),
});

const POCKET_ID = "8d9e0f1a-2b3c-4d4e-9f5a-6b7c8d9e0f1a";

export const listAccountDependents = defineRoute({
  id: "list_account_dependents",
  method: "GET",
  path: "/accounts/{id}/dependents",
  scope: "read",
  capability: "accounts",
  summary:
    "What rests on the account and has to move before it can be deleted, and the open accounts it can move to.",
  actions: ["accountDependentsAction"],
  params: byAccount,
  response: z.object({
    dependents: z.array(dependent),
    /** Empty when nothing has to move. */
    targets: z.array(z.object({ id: id(), name: z.string() })),
  }),
  errors: ["invalid", "not_found"],
  example: {
    params: { id: ACCOUNT_ID },
    response: {
      dependents: [{ kind: "pocket", id: POCKET_ID, label: "Holiday" }],
      targets: [{ id: OTHER_ACCOUNT_ID, name: "Savings" }],
    },
  },
});

export const moveAccountDependent = defineRoute({
  id: "move_account_dependent",
  method: "POST",
  path: "/accounts/{id}/dependents/move",
  scope: "write",
  capability: "accounts",
  summary: "Moves one thing that rests on the account to another open account.",
  actions: ["moveDependentAction"],
  params: byAccount,
  body: z.object({ kind: z.enum(DEPENDENT_KINDS), id: z.union([id(), z.literal("")]), to: id() }).strict(),
  response: null,
  status: 204,
  errors: REMOVAL_ERRORS,
  example: {
    params: { id: ACCOUNT_ID },
    body: { kind: "pocket", id: POCKET_ID, to: OTHER_ACCOUNT_ID },
  },
});

export const deleteAccount = defineRoute({
  id: "delete_account",
  method: "DELETE",
  path: "/accounts/{id}",
  scope: "write",
  capability: "accounts",
  summary:
    "Deletes the account with its movements and balances, only when nothing rests on it (`conflict`, reason `in_use`).",
  actions: ["deleteAccountAction"],
  params: byAccount,
  response: null,
  status: 204,
  errors: REMOVAL_ERRORS,
  example: { params: { id: ACCOUNT_ID } },
});
