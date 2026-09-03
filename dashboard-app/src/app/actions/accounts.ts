"use server";

import { revalidatePath } from "next/cache";
import { walletToken } from "@/lib/env";
import type { Account, AccountGroup } from "@/modules/accounts/domain/account";
import {
  createGroup,
  deleteGroup,
  renameGroup,
  type CreateGroupInput,
  type RenameGroupInput,
} from "@/modules/accounts/application/groups";
import {
  createManualAccount,
  type CreateManualAccountInput,
} from "@/modules/accounts/application/create-manual-account";
import {
  deleteAccount,
  type DeleteAccountResult,
} from "@/modules/accounts/application/delete-account";
import {
  DeletionBlockedError,
  InvalidInputError,
  VersionMismatchError,
} from "@/modules/accounts/application/errors";
import {
  recordManualBalance,
  type RecordManualBalanceInput,
} from "@/modules/accounts/application/record-manual-balance";
import {
  assertWalletSyncAllowed,
  syncProviderAccounts,
  type SyncProviderAccountsResult,
} from "@/modules/accounts/application/sync-provider-accounts";
import {
  updateAccount,
  type UpdateAccountInput,
} from "@/modules/accounts/application/update-account";
import { walletAccountsSource } from "@/modules/accounts/infrastructure/wallet-adapter";
import { runForPrincipal } from "@/modules/accounts/ui/deps";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { errorMessage, fail, succeed, text, type ActionResult } from "./types";

function revalidateAccounts(id?: string): void {
  revalidatePath("/");
  revalidatePath("/finance");
  revalidatePath("/finance/accounts");
  if (id !== undefined) revalidatePath(`/finance/accounts/${id}`);
}

/**
 * The one place every accounts action turns a thrown error into the copy the
 * brief pins down. Anything the use cases did not anticipate falls through to
 * `errorMessage`, which is still a message the owner can read rather than a
 * stack trace.
 */
function mapError(err: unknown): string {
  if (err instanceof PermissionDeniedError)
    return "You do not have permission to change accounts.";
  if (err instanceof VersionMismatchError)
    return "This account changed in the meantime. Reload and try again.";
  if (err instanceof DeletionBlockedError) {
    return "This account is still linked to Budget Makers Wallet. Confirm to archive it instead.";
  }
  if (err instanceof InvalidInputError) return err.message;
  return errorMessage(err);
}

function flag(formData: FormData, key: string): boolean {
  const raw = formData.get(key);
  return raw === "true" || raw === "on" || raw === "1";
}

function requiredText(formData: FormData, key: string): string {
  return text(formData.get(key)) ?? "";
}

export async function createAccountAction(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const asOf = text(formData.get("openingBalanceAsOf"));
  const balance = text(formData.get("openingBalance"));
  // Half an opening balance is a typo, not an instruction: silently dropping it
  // would create the account and lose the figure the owner just typed.
  if ((asOf === null) !== (balance === null)) {
    return fail("Enter both a date and an amount for the opening balance.");
  }

  const input: CreateManualAccountInput = {
    name: requiredText(formData, "name"),
    type: requiredText(formData, "type") as CreateManualAccountInput["type"],
    currency: text(formData.get("currency")) ?? undefined,
    groupId: text(formData.get("groupId")),
    includeInNetWorth: formData.has("includeInNetWorth")
      ? flag(formData, "includeInNetWorth")
      : undefined,
    notes: text(formData.get("notes")),
    openingBalance:
      asOf !== null && balance !== null ? { asOf, balance } : undefined,
  };

  try {
    const account = await runForPrincipal((deps, principal) =>
      createManualAccount(deps)(principal, input),
    );
    revalidateAccounts(account.id);
    return succeed({ id: account.id });
  } catch (err) {
    return fail(mapError(err));
  }
}

export async function updateAccountAction(
  formData: FormData,
): Promise<ActionResult<Account>> {
  const id = requiredText(formData, "id");
  const version = Number(requiredText(formData, "version"));

  const patch: UpdateAccountInput = {
    name: text(formData.get("name")) ?? undefined,
    type: (text(formData.get("type")) ??
      undefined) as UpdateAccountInput["type"],
    currency: text(formData.get("currency")) ?? undefined,
    groupId: formData.has("groupId")
      ? text(formData.get("groupId"))
      : undefined,
    includeInNetWorth: formData.has("includeInNetWorth")
      ? flag(formData, "includeInNetWorth")
      : undefined,
    notes: formData.has("notes") ? text(formData.get("notes")) : undefined,
  };

  try {
    const account = await runForPrincipal((deps, principal) =>
      updateAccount(deps)(principal, id, version, patch),
    );
    revalidateAccounts(id);
    return succeed(account);
  } catch (err) {
    return fail(mapError(err));
  }
}

/** The Management page's Restore: the one status transition `updateAccount` accepts from a caller. */
export async function restoreAccountAction(
  formData: FormData,
): Promise<ActionResult<Account>> {
  const id = requiredText(formData, "id");
  const version = Number(requiredText(formData, "version"));

  try {
    const account = await runForPrincipal((deps, principal) =>
      updateAccount(deps)(principal, id, version, {
        status: "active",
        archivedAt: null,
      }),
    );
    revalidateAccounts(id);
    return succeed(account);
  } catch (err) {
    return fail(mapError(err));
  }
}

export async function deleteAccountAction(
  formData: FormData,
): Promise<ActionResult<DeleteAccountResult>> {
  const id = requiredText(formData, "id");
  const confirmSynced = flag(formData, "confirmSynced");

  try {
    const result = await runForPrincipal((deps, principal) =>
      deleteAccount(deps)(principal, id, { confirmSynced }),
    );
    revalidateAccounts(id);
    return succeed(result);
  } catch (err) {
    return fail(mapError(err));
  }
}

export async function recordBalanceAction(
  formData: FormData,
): Promise<ActionResult<null>> {
  const id = requiredText(formData, "id");
  const input: RecordManualBalanceInput = {
    asOf: requiredText(formData, "asOf"),
    balance: requiredText(formData, "balance"),
    available: text(formData.get("available")),
  };

  try {
    await runForPrincipal((deps, principal) =>
      recordManualBalance(deps)(principal, id, input),
    );
    revalidateAccounts(id);
    return succeed(null);
  } catch (err) {
    return fail(mapError(err));
  }
}

/** Header action on the accounts list. Requires `WALLET_TOKEN_FILE`; reports rather than throws when it is unset. */
export async function syncWalletAction(): Promise<
  ActionResult<SyncProviderAccountsResult>
> {
  try {
    walletToken();
  } catch {
    return fail("Budget Makers Wallet is not configured.");
  }

  try {
    const source = walletAccountsSource({ now: () => new Date() });
    const incoming = await source.fetchAccounts();
    const result = await runForPrincipal((deps, principal) => {
      // The use case itself does not gate on a permission — the route and this
      // action are the two callers, and both go through the shared check.
      assertWalletSyncAllowed(principal);
      return syncProviderAccounts({ ...deps, source })(principal.userId, incoming);
    });
    revalidateAccounts();
    return succeed(result);
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return fail("Only the owner can sync Budget Makers Wallet in this release.");
    }
    return fail(mapError(err));
  }
}

export async function createGroupAction(
  formData: FormData,
): Promise<ActionResult<AccountGroup>> {
  const input: CreateGroupInput = { name: requiredText(formData, "name") };

  try {
    const group = await runForPrincipal((deps, principal) =>
      createGroup(deps)(principal, input),
    );
    revalidatePath("/finance/management/accounts");
    revalidateAccounts();
    return succeed(group);
  } catch (err) {
    return fail(mapError(err));
  }
}

export async function renameGroupAction(
  formData: FormData,
): Promise<ActionResult<AccountGroup>> {
  const id = requiredText(formData, "id");
  const input: RenameGroupInput = { name: requiredText(formData, "name") };

  try {
    const group = await runForPrincipal((deps, principal) =>
      renameGroup(deps)(principal, id, input),
    );
    revalidatePath("/finance/management/accounts");
    revalidateAccounts();
    return succeed(group);
  } catch (err) {
    return fail(mapError(err));
  }
}

export async function deleteGroupAction(
  formData: FormData,
): Promise<ActionResult<null>> {
  const id = requiredText(formData, "id");

  try {
    await runForPrincipal((deps, principal) =>
      deleteGroup(deps)(principal, id),
    );
    revalidatePath("/finance/management/accounts");
    revalidateAccounts();
    return succeed(null);
  } catch (err) {
    return fail(mapError(err));
  }
}
