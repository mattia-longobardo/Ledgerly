"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { syncWalletAction } from "@/app/actions/accounts";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { Toast } from "@/components/ui/Toast";
import { cn } from "@/components/ui/cn";
import { AccountForm, type AccountFormGroupOption } from "./AccountForm";

export interface AccountsToolbarProps {
  groups: readonly AccountFormGroupOption[];
  /** "header" adds the Sync action; "empty" adds a link to connect Wallet in Settings instead. */
  variant: "header" | "empty";
  className?: string;
}

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 text-body-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-40";

/** The two actions every accounts screen offers: add one by hand, or bring in what Budget Makers Wallet already knows. */
export function AccountsToolbar({
  groups,
  variant,
  className,
}: AccountsToolbarProps) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function sync() {
    setError(null);
    startTransition(async () => {
      const result = await syncWalletAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const { created, updated, adopted, missing } = result.data;
      setToast(
        `Synced: ${created} created, ${updated} updated, ${adopted} adopted, ${missing} now unavailable.`,
      );
      router.refresh();
    });
  }

  return (
    <span className={cn("flex flex-col items-start gap-2", className)}>
      {error !== null && <ErrorInline message={error} onRetry={sync} />}

      <span className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className={PRIMARY}
        >
          Add account
        </button>

        {variant === "header" ? (
          <button
            type="button"
            disabled={pending}
            onClick={sync}
            className={SECONDARY}
          >
            {pending && (
              <span
                aria-hidden
                className="mr-1.5 size-4 animate-spin rounded-full border-2 border-fg-muted/40 border-t-fg-muted"
              />
            )}
            Sync Budget Makers Wallet
          </button>
        ) : (
          <Link href="/settings" className={SECONDARY}>
            Connect Budget Makers Wallet
          </Link>
        )}
      </span>

      <AccountForm open={formOpen} onOpenChange={setFormOpen} groups={groups} />

      <Toast
        open={toast !== null}
        message={toast ?? ""}
        onOpenChange={(open) => {
          if (!open) setToast(null);
        }}
      />
    </span>
  );
}
