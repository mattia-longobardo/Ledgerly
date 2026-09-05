"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { restoreAccountAction } from "@/app/actions/accounts";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { cn } from "@/components/ui/cn";
import type {
  AccountOrigin,
  AccountType,
} from "@/modules/accounts/domain/account";
import {
  ACCOUNT_TYPE_LABEL,
  MANUAL_ORIGIN_LABEL,
  WALLET_ORIGIN_LABEL,
} from "@/modules/accounts/ui/labels";

export interface ArchivedAccountRow {
  id: string;
  version: number;
  name: string;
  type: AccountType;
  origin: AccountOrigin;
  balance: string | null;
}

const ROW_ACTION =
  "inline-flex min-h-11 items-center rounded-xs px-2 text-body-sm font-medium";

export function ArchivedAccountsList({
  accounts,
}: {
  accounts: readonly ArchivedAccountRow[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function restore(account: ArchivedAccountRow) {
    setError(null);
    setRestoringId(account.id);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", account.id);
      formData.set("version", String(account.version));
      const result = await restoreAccountAction(formData);
      setRestoringId(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (accounts.length === 0) {
    return <p className="text-body-sm text-fg-muted">No archived accounts.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {error !== null && <ErrorInline message={error} />}

      <ul className="hairline-t">
        {accounts.map((account) => (
          <li
            key={account.id}
            className="flex min-h-11 items-center gap-3 py-2 hairline-b"
          >
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="truncate text-body text-fg">
                  {account.name}
                </span>
                <span className="shrink-0 rounded-xs bg-surface-raised px-1.5 py-0.5 text-caption text-fg-muted">
                  {account.origin === "synced"
                    ? WALLET_ORIGIN_LABEL
                    : MANUAL_ORIGIN_LABEL}
                </span>
              </span>
              <span className="text-caption text-fg-muted">
                {ACCOUNT_TYPE_LABEL[account.type]}
              </span>
            </span>
            {account.balance !== null && (
              <MoneyValue
                value={account.balance}
                size="body"
                cents="muted"
                className="text-fg-muted"
              />
            )}
            <button
              type="button"
              disabled={pending && restoringId === account.id}
              onClick={() => restore(account)}
              className={cn(ROW_ACTION, "text-accent disabled:opacity-40")}
            >
              {pending && restoringId === account.id && (
                <span
                  aria-hidden
                  className="mr-1.5 size-4 animate-spin rounded-full border-2 border-accent/40 border-t-accent"
                />
              )}
              Restore
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
