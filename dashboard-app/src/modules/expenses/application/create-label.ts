import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { TransactionLabel } from "../domain/transaction";
import { InvalidInputError } from "./errors";
import type { UseCaseDeps } from "./ports";

export interface CreateLabelInput {
  name: string;
  color?: string | null;
}

export function createLabel(deps: UseCaseDeps) {
  return async (principal: Principal, input: CreateLabelInput): Promise<TransactionLabel> => {
    assertPermission(principal, "finance.manage");
    const name = input.name.trim();
    if (!name) throw new InvalidInputError("name is required");
    const created = await deps.labels.create({
      userId: principal.userId,
      name,
      color: input.color ?? null,
      source: "manual",
    });
    if (created === "duplicate_name") throw new InvalidInputError(`A label called "${name}" already exists`);
    await deps.audit({
      actorUserId: principal.userId,
      action: "expenses.label_created",
      entityType: "transaction_label",
      entityId: created.id,
      after: { name: created.name },
    });
    return created;
  };
}
