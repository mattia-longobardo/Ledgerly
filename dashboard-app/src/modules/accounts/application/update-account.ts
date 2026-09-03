import { z } from "zod";
import { assertPermission, type Principal } from "@/platform/auth/principal";
import type { Account } from "../domain/account";
import type { UseCaseDeps } from "./deps";
import type { AccountPatch } from "./ports";
import {
  InvalidInputError,
  NotFoundError,
  VersionMismatchError,
} from "./errors";

export const updateAccountSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(120).optional(),
  type: z
    .enum([
      "checking",
      "savings",
      "cash",
      "investment",
      "pension_fund",
      "crypto",
      "credit",
      "other",
    ])
    .optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  groupId: z.string().uuid().nullable().optional(),
  includeInNetWorth: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().optional(),
  /**
   * Restore only: the one status transition this endpoint accepts. Archiving
   * and marking unavailable are use-case-driven (`deleteAccount`, the provider
   * sync), never a raw field a caller can set — so the only value the schema
   * lets through is the one that undoes an archive. What it actually lands on
   * is decided below, not taken verbatim: see the guard in the body.
   */
  status: z.enum(["active"]).optional(),
  archivedAt: z.null().optional(),
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
      throw new InvalidInputError(
        parsed.error.issues[0]?.message ?? "Invalid input",
        parsed.error.issues,
      );
    }
    const patch = parsed.data;
    const before = await deps.accounts.get(principal.userId, id);
    if (!before) throw new NotFoundError();
    if (
      before.origin === "synced" &&
      (patch.type !== undefined || patch.currency !== undefined)
    ) {
      throw new InvalidInputError(
        "Type and currency are managed by the provider",
      );
    }

    let effectivePatch: AccountPatch = patch;
    if (patch.status !== undefined) {
      // The only status transition this schema admits is "active", i.e.
      // restore — and a restore only makes sense FROM archived. Without this
      // guard a crafted request carrying `status: "active"` could revive an
      // account that is merely `unavailable` (still archived from nothing),
      // or no-op-but-audit on one that is already active.
      if (before.status !== "archived") {
        throw new InvalidInputError("Only an archived account can be restored");
      }
      // The provider, not this endpoint, still owns whether a synced account
      // is actually live. Restoring one whose link is missing (or was never
      // linked) has to land it back at `unavailable`, not `active` — otherwise
      // the detail page's "Missing since" line goes stale the moment someone
      // clicks Restore, even though the provider still doesn't report it.
      const stillMissing =
        before.origin === "synced" &&
        (await deps.links.liveFor("account", id)) === null;
      effectivePatch = {
        ...patch,
        status: stillMissing ? "unavailable" : "active",
        archivedAt: null,
      };
    }

    const result = await deps.accounts.update(
      principal.userId,
      id,
      expectedVersion,
      effectivePatch,
    );
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
