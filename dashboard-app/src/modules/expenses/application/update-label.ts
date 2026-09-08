import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { TransactionLabel } from "../domain/transaction";
import { InvalidInputError, NotFoundError } from "./errors";
import type { LabelPatch, UseCaseDeps } from "./ports";

export interface UpdateLabelInput {
  name?: string;
  color?: string | null;
}

export function updateLabel(deps: UseCaseDeps) {
  return async (principal: Principal, id: string, input: UpdateLabelInput): Promise<TransactionLabel> => {
    assertPermission(principal, "finance.manage");
    const before = await deps.labels.get(principal.userId, id);
    if (!before) throw new NotFoundError("Label not found");

    const patch: LabelPatch = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new InvalidInputError("name cannot be empty");
      patch.name = name;
    }
    if (input.color !== undefined) patch.color = input.color;

    const updated = await deps.labels.update(principal.userId, id, patch);
    if (updated === null) throw new NotFoundError("Label not found");
    if (updated === "duplicate_name") throw new InvalidInputError(`A label called "${patch.name}" already exists`);
    await deps.audit({
      actorUserId: principal.userId,
      action: "expenses.label_updated",
      entityType: "transaction_label",
      entityId: id,
      before: { name: before.name, color: before.color },
      after: { name: updated.name, color: updated.color },
    });
    return updated;
  };
}
