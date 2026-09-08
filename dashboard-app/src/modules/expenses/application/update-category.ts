import type { ProviderLinksRepository } from "@/modules/accounts/application/ports";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { TransactionCategory } from "../domain/transaction";
import { InvalidInputError, NotFoundError } from "./errors";
import type { CategoryPatch, UseCaseDeps } from "./ports";

/**
 * `links` is not on the module's `UseCaseDeps` — only this use case and
 * `syncProviderTransactions` need it, and both take it as an extension rather
 * than widening the bag every other use case has to carry.
 */
export type UpdateCategoryDeps = UseCaseDeps & { links: ProviderLinksRepository };

export interface UpdateCategoryInput {
  name?: string;
  color?: string | null;
  parentId?: string | null;
  /** True archives the category; false brings it back. Transactions are never touched either way. */
  archived?: boolean;
}

export function updateCategory(deps: UpdateCategoryDeps) {
  return async (principal: Principal, id: string, input: UpdateCategoryInput): Promise<TransactionCategory> => {
    assertPermission(principal, "finance.manage");
    const before = await deps.categories.get(principal.userId, id);
    if (!before) throw new NotFoundError("Category not found");

    const patch: CategoryPatch = {};

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new InvalidInputError("name cannot be empty");
      if (name !== before.name) {
        // A category mirrored from a provider is matched back to that provider
        // by its link, but its NAME is what the sync overwrites on every pass
        // (`syncProviderTransactions` renames the local row to the provider's
        // label). Accepting a rename here would look like it worked and be
        // silently undone on the next sync, so it is refused outright.
        // `parentId` and `color` are local-only fields the sync never writes,
        // so those stay editable on a mirrored category.
        const link = await deps.links.liveFor("category", id);
        if (link) {
          throw new InvalidInputError(
            `This category is mirrored from ${link.provider} and is renamed there, not here. Its colour and parent can still be changed.`,
          );
        }
        patch.name = name;
      }
    }

    if (input.color !== undefined) patch.color = input.color;
    if (input.parentId !== undefined) {
      if (input.parentId !== null) {
        if (input.parentId === id) throw new InvalidInputError("A category cannot be its own parent");
        // `parent_id` is not FK-constrained (see `schema/transactions.ts`), so
        // an unverified id would write a dangling — possibly cross-tenant —
        // reference that nothing else would catch.
        const parent = await deps.categories.get(principal.userId, input.parentId);
        if (!parent) throw new InvalidInputError("parentId must belong to the caller");
      }
      patch.parentId = input.parentId;
    }
    if (input.archived !== undefined) {
      // Archiving sets a timestamp and nothing else: the row keeps its id, and
      // every transaction that points at it keeps pointing at it. Deleting a
      // category would orphan history, which is why there is no delete.
      patch.archivedAt = input.archived ? (before.archivedAt ?? deps.clock.now()) : null;
    }

    const updated = await deps.categories.update(principal.userId, id, patch);
    if (updated === null) throw new NotFoundError("Category not found");
    if (updated === "duplicate_name") throw new InvalidInputError(`A category called "${patch.name}" already exists`);
    await deps.audit({
      actorUserId: principal.userId,
      action: "expenses.category_updated",
      entityType: "transaction_category",
      entityId: id,
      before: { name: before.name, color: before.color, parentId: before.parentId, archivedAt: before.archivedAt },
      after: { name: updated.name, color: updated.color, parentId: updated.parentId, archivedAt: updated.archivedAt },
    });
    return updated;
  };
}
