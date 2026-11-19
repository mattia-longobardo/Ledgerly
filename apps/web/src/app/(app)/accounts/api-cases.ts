// src/app/(app)/accounts/api-cases.ts — the use cases of accounts that the web process lends
// `/api/v1` (rewrite plan R2), as it lends its guard: the deletion joins six modules from here, the
// switch needs the web's registry of providers and its bank sink, the monthly figures are the
// web's report, until R4. The Server Actions of these pages call the same functions.
import "server-only";
import { z } from "zod";
import type { AccountCases } from "@ledgerly/api";
import { redactForLog } from "@ledgerly/domain/platform/auth";
import { listAccounts } from "@ledgerly/domain/accounts";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { enqueue } from "@ledgerly/domain/platform/jobs";
import { monthKey, today } from "@ledgerly/domain/shared/dates";
import type { Presence } from "@ledgerly/plugin-host";
import { tasks } from "@/platform/jobs/queue";
import { monthlyFigures } from "@/platform/reports/monthly";
import { presenceOf } from "../banks/presence";
import {
  accountDependents,
  DEPENDENT_KINDS,
  DeleteError,
  type DeleteErrorCode,
  deleteAccount,
  moveDependent,
} from "./[id]/delete";
import { applySwitch, checkSwitch, type SwitchError, SwitchFailure, undoSwitch } from "./[id]/switch/switch";

type DeleteFailure = { ok: false; error: DeleteErrorCode | "failed" };
type SwitchRefusal = { ok: false; error: SwitchError; retryAt: string | null };

function deleteFailure(error: unknown): DeleteFailure {
  if (error instanceof DeleteError) return { ok: false, error: error.code };
  throw error;
}

function switchRefusal(error: unknown): SwitchRefusal {
  if (error instanceof SwitchFailure) {
    return { ok: false, error: error.code, retryAt: error.retryAt?.toISOString() ?? null };
  }
  console.error("[accounts] a switch failed", redactForLog(error));
  return { ok: false, error: "failed", retryAt: null };
}

/** What the dialog shows when it opens: what rests on the account, and where it can go. */
export async function dependentsOf(ctx: Ctx, accountId: string) {
  const id = z.uuid().safeParse(accountId);
  if (!id.success) return { ok: false as const, error: "not_found" as const };
  try {
    const dependents = await accountDependents(ctx, id.data);
    // Only when something has to move: the open accounts, without this one.
    const targets =
      dependents.length === 0
        ? []
        : (await listAccounts(ctx))
            .filter((account) => account.id !== id.data && account.state !== "archived")
            .map((account) => ({ id: account.id, name: account.name }));
    return { ok: true as const, dependents, targets };
  } catch (error) {
    return deleteFailure(error);
  }
}

const moveSchema = z.object({
  accountId: z.uuid(),
  kind: z.enum(DEPENDENT_KINDS),
  // A budget limit on the account alone has no category: its id is "".
  id: z.union([z.uuid(), z.literal("")]),
  to: z.uuid(),
});

export async function moveDependentOf(
  ctx: Ctx,
  input: { accountId: string; kind: string; id: string; to: string },
): Promise<{ ok: true; accountId: string; to: string } | DeleteFailure> {
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "failed" };
  try {
    await moveDependent(ctx, parsed.data.accountId, parsed.data);
    return { ok: true, accountId: parsed.data.accountId, to: parsed.data.to };
  } catch (error) {
    return deleteFailure(error);
  }
}

export async function deleteAccountOf(ctx: Ctx, accountId: string): Promise<{ ok: true } | DeleteFailure> {
  const id = z.uuid().safeParse(accountId);
  if (!id.success) return { ok: false, error: "not_found" };
  try {
    await deleteAccount(ctx, id.data);
    return { ok: true };
  } catch (error) {
    return deleteFailure(error);
  }
}

/** The dry run (§6): nothing is written but the normal update of the source of before. */
export async function checkSwitchOf(
  ctx: Ctx,
  accountId: string,
  target: { connectionId: string; bankAccountId: string },
  presence: Presence,
) {
  try {
    return { ok: true as const, report: await checkSwitch(ctx, accountId, target, presence) };
  } catch (error) {
    return switchRefusal(error);
  }
}

/** "Apply" (§8): only with the print of the report the person read. */
export async function applySwitchOf(
  ctx: Ctx,
  accountId: string,
  target: { connectionId: string; bankAccountId: string; fingerprint: string },
  presence: Presence,
) {
  try {
    const outcome = await applySwitch(ctx, accountId, target, presence);
    await enqueue(tasks.afterSync("manual"));
    return { ok: true as const, ...outcome };
  } catch (error) {
    return switchRefusal(error);
  }
}

/** "Undo switch" (§10). */
export async function undoSwitchOf(ctx: Ctx, accountId: string): Promise<{ ok: true } | SwitchRefusal> {
  try {
    await undoSwitch(ctx, accountId);
    await enqueue(tasks.afterSync("manual"));
    return { ok: true };
  } catch (error) {
    return switchRefusal(error);
  }
}

export const accountCases: AccountCases = {
  figures: (ctx) => monthlyFigures(ctx, monthKey(today(ctx.timeZone))),
  dependents: dependentsOf,
  moveDependent: moveDependentOf,
  deleteAccount: deleteAccountOf,
  checkSwitch: (ctx, id, target, headers) => checkSwitchOf(ctx, id, target, presenceOf(headers)),
  applySwitch: (ctx, id, target, headers) => applySwitchOf(ctx, id, target, presenceOf(headers)),
  undoSwitch: undoSwitchOf,
};
