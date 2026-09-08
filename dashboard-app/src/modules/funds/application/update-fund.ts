import { z } from "zod";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { InvalidInputError, NotFoundError } from "./errors";
import type { Fund, FundPatch, UseCaseDeps } from "./ports";
import { FUND_KINDS, FUND_STATUSES, parseInput } from "./validation";

const patchSchema = z.object({
  name: z.string().trim().min(1, "Invalid fund name.").optional(),
  kind: z.enum(FUND_KINDS).optional(),
  accountId: z.string().min(1).nullable().optional(),
  status: z.enum(FUND_STATUSES).optional(),
  archivedAt: z.date().nullable().optional(),
}).strict();

export function updateFund(deps: UseCaseDeps) {
  return async (principal: Principal, id: string, expectedVersion: number, patch: FundPatch): Promise<Fund> => {
    assertPermission(principal, "funds.write");
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new InvalidInputError("Invalid fund version.");
    const value = parseInput(patchSchema, patch);
    const before = await deps.funds.get(principal.userId, id);
    if (!before) throw new NotFoundError();
    if (value.accountId) {
      const account = await deps.accountLinks.get(principal.userId, value.accountId);
      if (!account) throw new InvalidInputError("Choose an account you own.");
      if (account.currency !== before.currency) throw new InvalidInputError("Fund and account currency must match.");
    }
    const effectivePatch: FundPatch = { ...value };
    if (value.status === "archived") effectivePatch.archivedAt = deps.clock.now();
    if (value.status === "active") effectivePatch.archivedAt = null;
    const after = await deps.funds.update(principal.userId, id, expectedVersion, effectivePatch);
    if (!after) throw new NotFoundError();
    await deps.audit({ actorUserId: principal.userId, action: "funds.fund_updated", entityType: "fund", entityId: after.id, before, after });
    return after;
  };
}
