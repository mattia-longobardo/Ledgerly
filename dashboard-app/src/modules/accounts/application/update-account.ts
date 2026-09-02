import { z } from "zod";
import { assertPermission, type Principal } from "@/platform/auth/principal";
import type { Account } from "../domain/account";
import type { UseCaseDeps } from "./deps";
import { InvalidInputError, NotFoundError, VersionMismatchError } from "./errors";

export const updateAccountSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(120).optional(),
  type: z.enum(["checking", "savings", "cash", "investment", "pension_fund", "crypto", "credit", "other"]).optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  groupId: z.string().uuid().nullable().optional(),
  includeInNetWorth: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().optional(),
});
export type UpdateAccountInput = z.input<typeof updateAccountSchema>;

export function updateAccount(deps: UseCaseDeps) {
  return async (
    principal: Principal,
    id: string,
    expectedVersion: number,
    raw: UpdateAccountInput,
  ): Promise<Account> => {
    assertPermission(principal, "accounts.write");
    const parsed = updateAccountSchema.safeParse(raw);
    if (!parsed.success) {
      throw new InvalidInputError(parsed.error.issues[0]?.message ?? "Invalid input", parsed.error.issues);
    }
    const patch = parsed.data;
    const before = await deps.accounts.get(principal.userId, id);
    if (!before) throw new NotFoundError();
    if (before.origin === "synced" && (patch.type !== undefined || patch.currency !== undefined)) {
      throw new InvalidInputError("Type and currency are managed by the provider");
    }
    const result = await deps.accounts.update(principal.userId, id, expectedVersion, patch);
    if (result === null) throw new NotFoundError();
    if (result === "version_mismatch") throw new VersionMismatchError();
    await deps.audit({
      actorUserId: principal.userId,
      action: "account.update",
      entityType: "account",
      entityId: result.id,
      before,
      after: result,
    });
    return result;
  };
}
