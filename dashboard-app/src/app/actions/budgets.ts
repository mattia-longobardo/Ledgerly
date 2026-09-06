"use server";

import { revalidatePath } from "next/cache";
import { addAllocation, type AddAllocationInput } from "@/modules/budgets/application/add-allocation";
import { addManualUsage, type AddManualUsageInput } from "@/modules/budgets/application/add-manual-usage";
import { createBudget } from "@/modules/budgets/application/create-budget";
import { deleteManualUsage } from "@/modules/budgets/application/delete-manual-usage";
import { endAllocation } from "@/modules/budgets/application/end-allocation";
import { InvalidInputError, NotFoundError, VersionMismatchError } from "@/modules/budgets/application/errors";
import type { Allocation, AmountVersion, Budget, BudgetPatch, NewBudget, Scope, Usage } from "@/modules/budgets/application/ports";
import { setInitialAmount, type SetInitialAmountInput } from "@/modules/budgets/application/set-initial-amount";
import { setScopes } from "@/modules/budgets/application/set-scopes";
import { updateBudget } from "@/modules/budgets/application/update-budget";
import type { ScopeLike } from "@/modules/budgets/domain/scopes";
import { runForPrincipal } from "@/modules/budgets/ui/deps";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { errorMessage, fail, parseMoney, succeed, text, toNumericString, type ActionResult } from "./types";

function required(data: FormData, key: string): string {
  return text(data.get(key)) ?? "";
}

function money(data: FormData, key: string): string | null {
  const parsed = parseMoney(data.get(key));
  return parsed === null ? null : toNumericString(parsed);
}

/**
 * Empty or absent means "no goal" (`null`) — never coerced into a stored
 * zero. `undefined` is a distinct sentinel meaning "present but not a valid
 * amount", so a typo doesn't silently clear a goal that was already set.
 */
function optionalMoney(data: FormData, key: string): string | null | undefined {
  const raw = text(data.get(key));
  if (raw === null) return null;
  const parsed = parseMoney(raw);
  return parsed === null ? undefined : toNumericString(parsed);
}

function labelsFrom(data: FormData, key: string): string[] {
  const raw = text(data.get(key));
  if (raw === null) return [];
  return raw
    .split(",")
    .map((label) => label.trim())
    .filter((label) => label !== "");
}

/** `undefined` means the JSON itself was malformed — distinct from an absent field, which is an empty list. */
function scopesFrom(data: FormData): ScopeLike[] | undefined {
  const raw = text(data.get("scopes"));
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ScopeLike[]) : undefined;
  } catch {
    return undefined;
  }
}

function mapError(error: unknown): string {
  if (error instanceof PermissionDeniedError) return "You do not have permission to change budgets.";
  if (error instanceof VersionMismatchError) return error.message;
  if (error instanceof NotFoundError) return error.message;
  if (error instanceof InvalidInputError) return error.message;
  return errorMessage(error);
}

function revalidateBudgets(id?: string): void {
  revalidatePath("/");
  revalidatePath("/finance/budgets");
  if (id) revalidatePath(`/finance/budgets/${id}`);
}

export async function createBudgetAction(data: FormData): Promise<ActionResult<Budget>> {
  const initialAmount = money(data, "initialAmount");
  if (initialAmount === null) return fail("Enter a valid opening amount.");
  const goalAmount = optionalMoney(data, "goalAmount");
  if (goalAmount === undefined) return fail("Enter a valid goal amount.");

  const input: Omit<NewBudget, "userId"> & { initialAmount: string } = {
    name: required(data, "name"),
    description: text(data.get("description")),
    currency: required(data, "currency").toUpperCase(),
    periodKind: required(data, "periodKind") as NewBudget["periodKind"],
    startDate: required(data, "startDate"),
    endDate: text(data.get("endDate")),
    goalAmount,
    labels: labelsFrom(data, "labels"),
    initialAmount,
  };

  try {
    const result = await runForPrincipal((deps, principal) => createBudget(deps)(principal, input));
    revalidateBudgets(result.id);
    return succeed(result);
  } catch (error) {
    return fail(mapError(error));
  }
}

export async function updateBudgetAction(data: FormData): Promise<ActionResult<Budget>> {
  const id = required(data, "id");
  const version = Number(required(data, "version"));
  const goalAmount = optionalMoney(data, "goalAmount");
  if (goalAmount === undefined) return fail("Enter a valid goal amount.");

  const patch: BudgetPatch = {
    name: required(data, "name"),
    description: text(data.get("description")),
    periodKind: required(data, "periodKind") as NewBudget["periodKind"],
    startDate: required(data, "startDate"),
    endDate: text(data.get("endDate")),
    goalAmount,
    labels: labelsFrom(data, "labels"),
    status: required(data, "status") as Budget["status"],
  };

  try {
    const result = await runForPrincipal((deps, principal) => updateBudget(deps)(principal, id, version, patch));
    revalidateBudgets(id);
    return succeed(result);
  } catch (error) {
    return fail(mapError(error));
  }
}

export async function setInitialAmountAction(data: FormData): Promise<ActionResult<AmountVersion>> {
  const budgetId = required(data, "budgetId");
  const initialAmount = money(data, "initialAmount");
  if (initialAmount === null) return fail("Enter a valid amount.");

  const input: SetInitialAmountInput = {
    initialAmount,
    effectiveFrom: required(data, "effectiveFrom"),
    reason: text(data.get("reason")),
  };

  try {
    const result = await runForPrincipal((deps, principal) => setInitialAmount(deps)(principal, budgetId, input));
    revalidateBudgets(budgetId);
    return succeed(result);
  } catch (error) {
    return fail(mapError(error));
  }
}

export async function addAllocationAction(data: FormData): Promise<ActionResult<Allocation>> {
  const budgetId = required(data, "budgetId");
  const amount = money(data, "amount");
  if (amount === null) return fail("Enter a valid allocation amount.");

  const sourceKind = required(data, "sourceKind") as AddAllocationInput["sourceKind"];
  const input: AddAllocationInput = {
    sourceKind,
    sourceId: sourceKind === "none" ? null : text(data.get("sourceId")),
    amount,
    recurrence: required(data, "recurrence") as AddAllocationInput["recurrence"],
    effectiveFrom: required(data, "effectiveFrom"),
    effectiveTo: text(data.get("effectiveTo")),
    note: text(data.get("note")),
  };

  try {
    const result = await runForPrincipal((deps, principal) => addAllocation(deps)(principal, budgetId, input));
    revalidateBudgets(budgetId);
    return succeed(result);
  } catch (error) {
    return fail(mapError(error));
  }
}

export async function endAllocationAction(data: FormData): Promise<ActionResult<Allocation>> {
  const budgetId = required(data, "budgetId");
  const allocationId = required(data, "allocationId");
  const version = Number(required(data, "version"));
  const effectiveTo = required(data, "effectiveTo");

  try {
    const result = await runForPrincipal((deps, principal) =>
      endAllocation(deps)(principal, budgetId, allocationId, version, effectiveTo),
    );
    revalidateBudgets(budgetId);
    return succeed(result);
  } catch (error) {
    return fail(mapError(error));
  }
}

export async function setScopesAction(data: FormData): Promise<ActionResult<Scope[]>> {
  const budgetId = required(data, "budgetId");
  const scopes = scopesFrom(data);
  if (scopes === undefined) return fail("Something went wrong reading the selected scopes.");

  try {
    const result = await runForPrincipal((deps, principal) => setScopes(deps)(principal, budgetId, scopes));
    revalidateBudgets(budgetId);
    return succeed(result);
  } catch (error) {
    return fail(mapError(error));
  }
}

export async function addManualUsageAction(data: FormData): Promise<ActionResult<Usage>> {
  const budgetId = required(data, "budgetId");
  const amount = money(data, "amount");
  if (amount === null) return fail("Enter a valid usage amount.");

  const input: AddManualUsageInput = {
    amount,
    occurredAt: required(data, "occurredAt"),
    note: text(data.get("note")),
  };

  try {
    const result = await runForPrincipal((deps, principal) => addManualUsage(deps)(principal, budgetId, input));
    revalidateBudgets(budgetId);
    return succeed(result);
  } catch (error) {
    return fail(mapError(error));
  }
}

export async function deleteManualUsageAction(data: FormData): Promise<ActionResult<null>> {
  const budgetId = required(data, "budgetId");
  const usageId = required(data, "usageId");

  try {
    await runForPrincipal((deps, principal) => deleteManualUsage(deps)(principal, budgetId, usageId));
    revalidateBudgets(budgetId);
    return succeed(null);
  } catch (error) {
    return fail(mapError(error));
  }
}
