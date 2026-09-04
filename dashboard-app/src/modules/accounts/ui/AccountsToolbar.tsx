"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/components/ui/cn";
import { AccountForm, type AccountFormGroupOption } from "./AccountForm";

export interface AccountsToolbarProps {
  groups: readonly AccountFormGroupOption[];
  /** "header" links to manage Budget Makers Wallet; "empty" links to connect it instead. */
  variant: "header" | "empty";
  className?: string;
}

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 text-body-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-40";

/** The two actions every accounts screen offers: add one by hand, or manage what Budget Makers Wallet already knows in Settings. */
export function AccountsToolbar({
  groups,
  variant,
  className,
}: AccountsToolbarProps) {
  const [formOpen, setFormOpen] = useState(false);

  return (
    <span className={cn("flex flex-col items-start gap-2", className)}>
      <span className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className={PRIMARY}
        >
          Add account
        </button>

        <Link href="/settings" className={SECONDARY}>
          {variant === "header" ? "Manage Budget Makers Wallet" : "Connect Budget Makers Wallet"}
        </Link>
      </span>

      <AccountForm open={formOpen} onOpenChange={setFormOpen} groups={groups} />
    </span>
  );
}
