import { z } from "zod";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { InvalidInputError, NotFoundError } from "./errors";
import type { Allocation, UseCaseDeps } from "./ports";
import { dateSchema, moneyCents, moneySchema, parseInput, RECURRENCES, SOURCE_KINDS } from "./validation";

export interface AddAllocationInput {
  sourceKind: "fund" | "account" | "none";
  sourceId?: string | null;
  amount: string;
  recurrence: "once" | "monthly";
  effectiveFrom: string;
  effectiveTo?: string | null;
  note?: string | null;
}

const schema = z
  .object({
    sourceKind: z.enum(SOURCE_KINDS),
    sourceId: z.string().min(1).nullable().optional(),
    amount: moneySchema,
    recurrence: z.enum(RECURRENCES),
    effectiveFrom: dateSchema,
    effectiveTo: dateSchema.nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const sourceId = value.sourceId ?? null;
    if (value.sourceKind === "none" && sourceId !== null) {
      ctx.addIssue({ code: "custom", message: "Invalid: sourceKind 'none' requires a null sourceId." });
    }
    if (value.sourceKind !== "none" && sourceId === null) {
      ctx.addIssue({ code: "custom", message: "Invalid: a fund or account source requires a sourceId." });
    }
    if (value.effectiveTo != null && value.effectiveTo < value.effectiveFrom) {
      ctx.addIssue({ code: "custom", message: "Invalid: effectiveTo can't be before effectiveFrom." });
    }
  });

export function addAllocation(deps: UseCaseDeps) {
  return async (principal: Principal, budgetId: string, input: AddAllocationInput): Promise<Allocation> => {
    assertPermission(principal, "budgets.write");
    const value = parseInput(schema, input);
    if (moneyCents(value.amount) === 0n) throw new InvalidInputError("Allocation amount must not be zero.");

    const budget = await deps.budgets.get(principal.userId, budgetId);
    if (!budget) throw new NotFoundError();

    const sourceId = value.sourceKind === "none" ? null : (value.sourceId as string);
    if (value.sourceKind === "fund") {
      if (!(await deps.ownership.fundExists(principal.userId, sourceId!))) throw new InvalidInputError("Choose a fund you own.");
    } else if (value.sourceKind === "account") {
      if (!(await deps.ownership.accountExists(principal.userId, sourceId!))) throw new InvalidInputError("Choose an account you own.");
    }

    const allocation = await deps.allocations.create({
      budgetId,
      sourceKind: value.sourceKind,
      sourceId,
      amount: value.amount,
      recurrence: value.recurrence,
      effectiveFrom: value.effectiveFrom,
      effectiveTo: value.effectiveTo ?? null,
      note: value.note ?? null,
      actorUserId: principal.userId,
    });
    await deps.audit({
      actorUserId: principal.userId,
      action: "budgets.allocation_added",
      entityType: "budget_allocation",
      entityId: allocation.id,
      after: allocation,
    });
    await deps.events.add({ budgetId, kind: "allocation_added", detail: { allocation }, actorUserId: principal.userId });
    return allocation;
  };
}
