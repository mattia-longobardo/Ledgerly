// src/app/(app)/accounts/[id]/delete.ts — the deletion of an account (PERS-419): what rests on it,
// the move of each of those things to another account, then the deletion itself and the source
// told that the account is no longer chosen. Here and not in a module because it joins six: the
// accounts module does not read the tables of the others (§4.2), and each owner moves its own rows.
import "server-only";
import { getAccount } from "@ledgerly/domain/accounts";
import { AccountError, removeAccount } from "@ledgerly/domain/accounts";
import { BudgetError, limitsOnAccount, moveLimitsAccount } from "@ledgerly/domain/budgets";
import {
  FundError,
  fundsOnAccount,
  moveFundAccount,
  moveFundSourceAccount,
  releaseFormerAccountReferences,
} from "@ledgerly/domain/funds";
import { InterestError, moveRuleAccount, rulesToMove } from "@ledgerly/domain/interests";
import { movePocketAccount, PocketError, pocketsToMove } from "@ledgerly/domain/pockets";
import {
  moveSubscriptionAccount,
  SubscriptionError,
  subscriptionsToMove,
} from "@ledgerly/domain/subscriptions";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { skipSourceAccount } from "@ledgerly/domain/platform/integrations";

export const DEPENDENT_KINDS = [
  "pocket",
  "interestRule",
  "budgetLimit",
  "subscription",
  "fund",
  "fundSource",
] as const;
type DependentKind = (typeof DEPENDENT_KINDS)[number];

/**
 * One thing that rests on an account. `label` is what the dialog names it by — a pocket's name, a
 * fund's name, a category's name, a rule's first day — and `null` when it has none (a budget limit
 * on the account alone). A budget limit's `id` is its category, or `""` for the account alone.
 */
export interface Dependent {
  kind: DependentKind;
  id: string;
  label: string | null;
}

/** Why a move or a deletion was refused, as the dialog says it. */
export type DeleteErrorCode =
  | "not_found"
  /** The target is archived, or not one of the person's accounts. */
  | "invalid_account"
  /** An interest rule that publishes to the source needs an account of a source. */
  | "not_synced"
  /** The target already has a budget limit of the same scope for one of those months. */
  | "conflict"
  /** The target already values another fund. */
  | "account_taken"
  | "same_account"
  /** Something still rests on the account. */
  | "in_use";

export class DeleteError extends Error {
  constructor(readonly code: DeleteErrorCode) {
    super(code);
    this.name = "DeleteError";
  }
}

async function requireOwn(ctx: Pick<Ctx, "userId">, accountId: string): Promise<void> {
  if (!(await getAccount(ctx, accountId))) throw new DeleteError("not_found");
}

/** Everything that rests on the account, in the order of the dialog. */
export async function accountDependents(ctx: Pick<Ctx, "userId">, accountId: string): Promise<Dependent[]> {
  await requireOwn(ctx, accountId);
  const [pockets, rules, limits, subscriptions, funds] = await Promise.all([
    pocketsToMove(ctx, accountId),
    rulesToMove(ctx, accountId),
    limitsOnAccount(ctx, accountId),
    subscriptionsToMove(ctx, accountId),
    fundsOnAccount(ctx, accountId),
  ]);
  return [
    ...pockets.map((one): Dependent => ({ kind: "pocket", id: one.id, label: one.name })),
    ...rules.map((one): Dependent => ({ kind: "interestRule", id: one.id, label: one.validFrom })),
    ...limits.map((one): Dependent => ({
      kind: "budgetLimit",
      id: one.categoryId ?? "",
      label: one.categoryName,
    })),
    ...subscriptions.map((one): Dependent => ({ kind: "subscription", id: one.id, label: one.name })),
    ...funds.funds.map((one): Dependent => ({ kind: "fund", id: one.id, label: one.name })),
    ...funds.sources.map((one): Dependent => ({ kind: "fundSource", id: one.id, label: one.fundName })),
  ];
}

/** The refusal of a module, as one code of the dialog. */
function refusal(error: unknown): DeleteError | null {
  if (
    error instanceof PocketError ||
    error instanceof InterestError ||
    error instanceof BudgetError ||
    error instanceof SubscriptionError ||
    error instanceof FundError
  ) {
    const code: string = error.code;
    if (code === "not_synced" || code === "conflict" || code === "account_taken")
      return new DeleteError(code);
    if (code === "not_found" && !(error instanceof BudgetError)) return new DeleteError("not_found");
    // A budget's `not_found` is its scope check: the target account is not an open one.
    return new DeleteError("invalid_account");
  }
  return null;
}

/** Moves one thing that rests on `accountId` to the account `to`, with its owner's own checks. */
export async function moveDependent(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountId: string,
  input: { kind: DependentKind; id: string; to: string },
): Promise<void> {
  if (input.to === accountId) throw new DeleteError("same_account");
  await requireOwn(ctx, accountId);
  // Only what rests on this account: an id of something else is "not found", never a move.
  const listed = await accountDependents(ctx, accountId);
  if (!listed.some((one) => one.kind === input.kind && one.id === input.id))
    throw new DeleteError("not_found");
  try {
    if (input.kind === "pocket") await movePocketAccount(ctx, input.id, input.to);
    else if (input.kind === "interestRule") await moveRuleAccount(ctx, input.id, input.to);
    else if (input.kind === "budgetLimit") {
      await moveLimitsAccount(ctx, { accountId, categoryId: input.id === "" ? null : input.id }, input.to);
    } else if (input.kind === "subscription") await moveSubscriptionAccount(ctx, input.id, input.to);
    else if (input.kind === "fund") await moveFundAccount(ctx, input.id, input.to);
    else await moveFundSourceAccount(ctx, input.id, input.to);
  } catch (error) {
    throw refusal(error) ?? error;
  }
}

/**
 * Deletes the account, with its movements and balances, only when nothing rests on it any more.
 * It never archives. An account of a source leaves the accounts that source brings here, so the
 * next reading does not make it again: it comes back only when the person chooses it again on the
 * page of the integration (a bank's account is no longer tied once deleted, and a bank reads tied
 * accounts only).
 */
export async function deleteAccount(ctx: Pick<Ctx, "userId">, accountId: string): Promise<void> {
  if ((await accountDependents(ctx, accountId)).length > 0) throw new DeleteError("in_use");
  await releaseFormerAccountReferences(ctx, accountId);
  let deleted;
  try {
    deleted = await removeAccount(ctx, accountId);
  } catch (error) {
    if (error instanceof AccountError && error.code === "in_use") throw new DeleteError("in_use");
    if (error instanceof AccountError && error.code === "not_found") throw new DeleteError("not_found");
    throw error;
  }
  for (const source of deleted.sources) {
    await skipSourceAccount(ctx, source.provider, source.providerAccountId, deleted.name);
  }
}
