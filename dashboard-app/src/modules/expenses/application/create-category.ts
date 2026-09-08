import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { CategoryKind, TransactionCategory } from "../domain/transaction";
import { InvalidInputError } from "./errors";
import type { UseCaseDeps } from "./ports";

export interface CreateCategoryInput {
  name: string;
  kind?: CategoryKind;
  groupName?: string | null;
  color?: string | null;
  parentId?: string | null;
}

/**
 * A category the person authored, so `source` is always `manual` — a caller
 * cannot claim a row was mirrored from a provider, which is what would let it
 * dodge the rename guard in `updateCategory`.
 */
export function createCategory(deps: UseCaseDeps) {
  return async (principal: Principal, input: CreateCategoryInput): Promise<TransactionCategory> => {
    assertPermission(principal, "finance.manage");
    const name = input.name.trim();
    if (!name) throw new InvalidInputError("name is required");
    if (input.parentId) {
      // An unverified parent id would write a cross-tenant foreign key —
      // `parent_id` is not FK-constrained (see the schema comment), so nothing
      // below this line would catch it.
      const parent = await deps.categories.get(principal.userId, input.parentId);
      if (!parent) throw new InvalidInputError("parentId must belong to the caller");
    }
    const created = await deps.categories.create({
      userId: principal.userId,
      name,
      groupName: input.groupName ?? null,
      kind: input.kind ?? "expense",
      color: input.color ?? null,
      parentId: input.parentId ?? null,
      source: "manual",
      archivedAt: null,
    });
    if (created === "duplicate_name") throw new InvalidInputError(`A category called "${name}" already exists`);
    await deps.audit({
      actorUserId: principal.userId,
      action: "expenses.category_created",
      entityType: "transaction_category",
      entityId: created.id,
      after: { name: created.name, kind: created.kind },
    });
    return created;
  };
}
