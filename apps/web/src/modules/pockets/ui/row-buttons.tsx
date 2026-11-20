"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { ConfirmDialog } from "@ledgerly/ui/form-dialog";
import { notify } from "@ledgerly/ui/toast";
import { type PocketResult, removePlannedExpense, setPocketState, unlinkExpense } from "../calls";

/** A row's button that asks first, then writes, and says how it went. */
function ConfirmButton({
  label,
  hidden,
  title,
  description,
  done,
  write,
}: {
  label: string;
  /** Read after the label by a screen reader: which row it is. */
  hidden: string;
  title: string;
  description: string;
  done: string;
  write: () => Promise<PocketResult>;
}) {
  const text = useTranslations("pockets");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        {label}
        <span className="sr-only"> {hidden}</span>
      </Button>
      {open && (
        <ConfirmDialog
          onClose={() => setOpen(false)}
          title={title}
          description={description}
          cancelLabel={text("form.cancel")}
          confirmLabel={label}
          pending={pending}
          onConfirm={() =>
            startTransition(async () => {
              const result = await write();
              notify(result.ok ? done : text("errors.failed"), result.ok ? "success" : "error");
              if (result.ok) setOpen(false);
            })
          }
        />
      )}
    </>
  );
}

/** "Remove" on a planned expense. */
export function RemovePlannedButton({ id, description }: { id: string; description: string }) {
  const text = useTranslations("pockets");
  return (
    <ConfirmButton
      label={text("planned.remove")}
      hidden={description}
      title={text("planned.confirmTitle")}
      description={text("planned.confirmDescription", { description })}
      done={text("toasts.plannedRemoved", { description })}
      write={() => removePlannedExpense(id)}
    />
  );
}

/** "Unlink" on an expense filed under a standalone pocket by hand. */
export function UnlinkExpenseButton({
  pocketId,
  transactionId,
  label,
}: {
  pocketId: string;
  transactionId: string;
  label: string;
}) {
  const text = useTranslations("pockets");
  return (
    <ConfirmButton
      label={text("expenses.unlink")}
      hidden={label}
      title={text("expenses.confirmTitle")}
      description={text("expenses.confirmDescription", { label })}
      done={text("toasts.unlinked", { label })}
      write={() => unlinkExpense(pocketId, transactionId)}
    />
  );
}

/** "Restore" on an archived pocket. */
export function RestorePocket({ id }: { id: string }) {
  const text = useTranslations("pockets");
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          if ((await setPocketState(id, "active")).ok) notify(text("toasts.restored"));
        })
      }
    >
      {text("actions.restore")}
    </Button>
  );
}
