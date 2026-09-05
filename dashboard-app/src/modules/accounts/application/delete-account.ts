import { assertPermission, type Principal } from "@/platform/auth/principal";
import { deletionDecision } from "../domain/account";
import type { UseCaseDeps } from "./deps";
import { DeletionBlockedError, NotFoundError, VersionMismatchError } from "./errors";

export interface DeleteAccountResult {
  outcome: "deleted" | "archived";
}

export function deleteAccount(deps: UseCaseDeps) {
  return async (
    principal: Principal,
    id: string,
    opts?: { confirmSynced?: boolean },
  ): Promise<DeleteAccountResult> => {
    assertPermission(principal, "accounts.delete");
    const account = await deps.accounts.get(principal.userId, id);
    if (!account) throw new NotFoundError();

    const decision = deletionDecision(account, {
      hasLiveProviderLink: (await deps.links.liveFor("account", id)) !== null,
      hasReferences: await deps.accounts.hasReferences(id),
    });

    if (decision === "blocked_linked" && !opts?.confirmSynced) throw new DeletionBlockedError();

    if (decision === "hard_delete") {
      await deps.accounts.delete(principal.userId, id);
      await deps.audit({
        actorUserId: principal.userId,
        action: "account.delete",
        entityType: "account",
        entityId: id,
        before: account,
      });
      return { outcome: "deleted" };
    }

    const archived = await deps.accounts.update(principal.userId, id, account.version, {
      status: "archived",
      archivedAt: deps.clock.now(),
    });
    if (archived === null) throw new NotFoundError();
    if (archived === "version_mismatch") throw new VersionMismatchError();
    await deps.audit({
      actorUserId: principal.userId,
      action: "account.archive",
      entityType: "account",
      entityId: id,
      before: account,
      after: archived,
    });
    return { outcome: "archived" };
  };
}
