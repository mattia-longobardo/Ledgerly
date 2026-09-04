import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { Transaction } from "../domain/transaction";
import { NotFoundError, VersionMismatchError } from "./errors";
import type { TransactionPatch, UseCaseDeps } from "./ports";

export interface UpdateTransactionInput {
  categoryId?: string | null;
  note?: string | null;
  state?: Transaction["state"];
  labelIds?: string[];
}

export function updateTransaction(deps: UseCaseDeps) {
  return async (
    principal: Principal,
    id: string,
    expectedVersion: number,
    input: UpdateTransactionInput,
  ): Promise<Transaction> => {
    assertPermission(principal, "expenses.write");
    const patch: TransactionPatch = {};
    if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
    if (input.note !== undefined) patch.note = input.note;
    if (input.state !== undefined) patch.state = input.state;
    const result = await deps.transactions.update(principal.userId, id, expectedVersion, patch);
    if (result === null) throw new NotFoundError();
    if (result === "version_mismatch") throw new VersionMismatchError();
    if (input.labelIds !== undefined) await deps.transactions.setLabels(principal.userId, id, input.labelIds);
    await deps.audit({
      actorUserId: principal.userId,
      action: "expenses.transaction_updated",
      entityType: "transaction",
      entityId: id,
      after: input,
    });
    return result;
  };
}
