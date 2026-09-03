"use client";

import { useState } from "react";
import {
  AccountForm,
  type AccountFormAccount,
  type AccountFormGroupOption,
} from "@/modules/accounts/ui/AccountForm";
import { BalanceForm } from "@/modules/accounts/ui/BalanceForm";
import { DeleteAccountButton } from "@/modules/accounts/ui/DeleteAccountButton";

export interface AccountDetailActionsProps {
  account: AccountFormAccount;
  groups: readonly AccountFormGroupOption[];
  today: string;
}

const SECONDARY =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 text-body-sm font-medium text-fg transition-colors hover:bg-surface-hover";

/** Edit, Record balance (manual only) and Archive/Delete, each behind its own sheet or confirm step. */
export function AccountDetailActions({
  account,
  groups,
  today,
}: AccountDetailActionsProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [balanceOpen, setBalanceOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setEditOpen(true)}
        className={SECONDARY}
      >
        Edit
      </button>

      {account.origin === "manual" && (
        <button
          type="button"
          onClick={() => setBalanceOpen(true)}
          className={SECONDARY}
        >
          Record balance
        </button>
      )}

      <DeleteAccountButton
        accountId={account.id}
        origin={account.origin}
        redirectTo="/finance/accounts"
      />

      <AccountForm
        open={editOpen}
        onOpenChange={setEditOpen}
        groups={groups}
        account={account}
      />
      <BalanceForm
        open={balanceOpen}
        onOpenChange={setBalanceOpen}
        accountId={account.id}
        today={today}
      />
    </div>
  );
}
