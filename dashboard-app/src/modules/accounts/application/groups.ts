import { z } from "zod";
import { assertPermission, type Principal } from "@/platform/auth/principal";
import type { AccountGroup } from "../domain/account";
import type { UseCaseDeps } from "./deps";
import { InvalidInputError, NotFoundError } from "./errors";

const nameSchema = z.string().trim().min(1, "Enter a name.").max(120);

export function listGroups(deps: UseCaseDeps) {
  return async (principal: Principal): Promise<AccountGroup[]> => {
    assertPermission(principal, "accounts.read");
    return deps.groups.list(principal.userId);
  };
}

export const createGroupSchema = z.object({
  name: nameSchema,
  sortOrder: z.number().int().optional(),
});
export type CreateGroupInput = z.input<typeof createGroupSchema>;

export function createGroup(deps: UseCaseDeps) {
  return async (principal: Principal, raw: CreateGroupInput): Promise<AccountGroup> => {
    assertPermission(principal, "accounts.write");
    const parsed = createGroupSchema.safeParse(raw);
    if (!parsed.success) {
      throw new InvalidInputError(parsed.error.issues[0]?.message ?? "Invalid input", parsed.error.issues);
    }
    const result = await deps.groups.create(principal.userId, parsed.data.name, parsed.data.sortOrder);
    if (result === "duplicate_name") throw new InvalidInputError("A group with this name already exists");
    await deps.audit({
      actorUserId: principal.userId,
      action: "account_group.create",
      entityType: "account_group",
      entityId: result.id,
      after: result,
    });
    return result;
  };
}

export const renameGroupSchema = z.object({ name: nameSchema });
export type RenameGroupInput = z.input<typeof renameGroupSchema>;

export function renameGroup(deps: UseCaseDeps) {
  return async (principal: Principal, id: string, raw: RenameGroupInput): Promise<AccountGroup> => {
    assertPermission(principal, "accounts.write");
    const parsed = renameGroupSchema.safeParse(raw);
    if (!parsed.success) {
      throw new InvalidInputError(parsed.error.issues[0]?.message ?? "Invalid input", parsed.error.issues);
    }
    const before = await deps.groups.get(principal.userId, id);
    if (!before) throw new NotFoundError("Group not found");
    const result = await deps.groups.rename(principal.userId, id, parsed.data.name);
    if (result === "duplicate_name") throw new InvalidInputError("A group with this name already exists");
    if (result === null) throw new NotFoundError("Group not found");
    await deps.audit({
      actorUserId: principal.userId,
      action: "account_group.rename",
      entityType: "account_group",
      entityId: result.id,
      before,
      after: result,
    });
    return result;
  };
}

export function deleteGroup(deps: UseCaseDeps) {
  return async (principal: Principal, id: string): Promise<void> => {
    assertPermission(principal, "accounts.write");
    const before = await deps.groups.get(principal.userId, id);
    if (!before) throw new NotFoundError("Group not found");
    await deps.groups.delete(principal.userId, id);
    await deps.audit({
      actorUserId: principal.userId,
      action: "account_group.delete",
      entityType: "account_group",
      entityId: id,
      before,
    });
  };
}
