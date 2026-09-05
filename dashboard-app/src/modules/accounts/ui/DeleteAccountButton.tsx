"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteAccountAction } from "@/app/actions/accounts";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { cn } from "@/components/ui/cn";
import type { AccountOrigin } from "../domain/account";

export interface DeleteAccountButtonProps {
  accountId: string;
  origin: AccountOrigin;
  /** Where to send the caller once the account is gone from this screen. */
  redirectTo: string;
  className?: string;
}

const ROW_ACTION =
  "inline-flex min-h-11 items-center rounded-xs px-2 text-body-sm font-medium";

/**
 * States the outcome before it happens, because "delete" means two different
 * things here: a manual account with nothing pointing at it is gone for good,
 * while a synced one is archived — its history stays, only the live row goes —
 * because Budget Makers Wallet, not this screen, owns whether it still exists.
 */
export function DeleteAccountButton({
  accountId,
  origin,
  redirectTo,
  className,
}: DeleteAccountButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const outcome =
    origin === "synced"
      ? "This account will be archived because it is linked to Budget Makers Wallet."
      : "This account will be permanently deleted.";

  function confirm() {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", accountId);
      formData.set("confirmSynced", origin === "synced" ? "true" : "false");
      const result = await deleteAccountAction(formData);
      if (!result.ok) {
        setError(result.error);
        setConfirming(false);
        return;
      }
      router.push(redirectTo);
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <div className={className}>
        {error !== null && <ErrorInline message={error} className="mb-2" />}
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={cn(ROW_ACTION, "text-negative")}
        >
          {origin === "synced" ? "Archive" : "Delete"}
        </button>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Confirm delete"
      className={cn("flex flex-col gap-2", className)}
    >
      {error !== null && <ErrorInline message={error} />}
      <p className="text-body-sm text-fg">{outcome}</p>
      <div className="flex gap-1">
        <button
          type="button"
          disabled={pending}
          onClick={confirm}
          className={cn(ROW_ACTION, "text-negative disabled:opacity-40")}
        >
          {pending && (
            <span
              aria-hidden
              className="mr-1.5 size-4 animate-spin rounded-full border-2 border-negative/40 border-t-negative"
            />
          )}
          {origin === "synced" ? "Confirm archive" : "Confirm delete"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(false)}
          className={cn(ROW_ACTION, "text-fg-muted disabled:opacity-40")}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
