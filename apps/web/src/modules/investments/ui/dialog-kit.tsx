"use client";

// What the dialogs of Investments share (audit UI-INV-7): the service they act on, the words of a
// refusal, a button that mounts its dialog only while open, and a confirmation that waits for its
// write. The fields and the dialog frames are `packages/ui`'s (UI-DS-9…UI-DS-11).
import { useTranslations } from "next-intl";
import { type ReactNode, useState, useTransition } from "react";
import type { NumberFormat, UiLocale } from "@ledgerly/format/format";
import { Button } from "@ledgerly/ui/button";
import { Field } from "@ledgerly/ui/field";
import { ConfirmDialog } from "@ledgerly/ui/form-dialog";
import { Input } from "@ledgerly/ui/input";
import { useMutationResult } from "@ledgerly/ui/mutation-result";
import { notify } from "@ledgerly/ui/toast";

/** What every dialog of a service page needs to know about it. */
export interface ServiceContext {
  accountId: string;
  name: string;
  currency: string;
  numberFormat: NumberFormat;
  locale: UiLocale;
  today: string;
  mode: "assets" | "total" | null;
  synced: boolean;
  /** A manual service on an account typed by hand: "Update value" writes its balance (PERS-342). */
  valueEditable: boolean;
  /** A manual portfolio (R5d): «Record operation», positions with their price mode, and cash. */
  portfolio: boolean;
}

/** The refusals the dialogs have words for; any other is «failed». */
const KNOWN_ERRORS = [
  "invalid",
  "not_found",
  "future_date",
  "not_eligible",
  "wrong_mode",
  "negative_cash",
  "no_value",
  "duplicate_asset",
  "duplicate_holding",
  "invalid_transaction",
  "already_linked",
  "not_editable",
  "before_period",
  "managed_locked",
  "unknown_provider",
  "invalid_credentials",
  "not_read_only",
  "provider_auth",
  "provider_unavailable",
  "rate_limited",
  "unsupported_currency",
  "already_connected",
  "not_connected",
  "cooldown",
  "different_account",
  "sync_failed",
  "sync_refused",
  "not_a_transfer",
  "quantity_exceeded",
] as const;

/** A refusal's code in the person's words. */
export function useErrorText(): (code: string) => string {
  const text = useTranslations("investments");
  return (code) => text(`errors.${KNOWN_ERRORS.find((known) => known === code) ?? "failed"}`);
}

/** The answer of a form's write: the refusal stays on the dialog's error line. */
export function useInvestmentResult() {
  return useMutationResult(useErrorText());
}

/** A toast for the answer of a command with no dialog: what it did, or the refusal. */
export function useOutcome(): (result: { ok: true } | { ok: false; error: string }, done: string) => void {
  const errorText = useErrorText();
  return (result, done) =>
    notify(result.ok ? done : errorText(result.error), result.ok ? "success" : "error");
}

/** A dialog opened by a button, mounted only while open (its state starts fresh every time). */
export function Opener({
  label,
  variant = "secondary",
  size = "sm",
  children,
}: {
  label: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "xs" | "sm" | "md";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && children(() => setOpen(false))}
    </>
  );
}

/** Asks before a destructive write; it closes once the write went through. */
export function ConfirmAction({
  onClose,
  title,
  description,
  confirm,
  onConfirm,
}: {
  onClose: () => void;
  title: string;
  description: string;
  confirm: string;
  onConfirm: () => Promise<boolean>;
}) {
  const text = useTranslations("investments");
  const [pending, startTransition] = useTransition();
  return (
    <ConfirmDialog
      onClose={onClose}
      title={title}
      description={description}
      cancelLabel={text("form.cancel")}
      confirmLabel={confirm}
      pending={pending}
      onConfirm={() =>
        startTransition(async () => {
          if (await onConfirm()) onClose();
        })
      }
    />
  );
}

/** The note of an operation, across the form. */
export function NoteField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (note: string) => void;
}) {
  const text = useTranslations("investments");
  return (
    <div className="col-span-full">
      <Field label={text("form.note")} htmlFor={id}>
        <Input id={id} maxLength={200} value={value} onChange={(event) => onChange(event.target.value)} />
      </Field>
    </div>
  );
}

/** The frame of a form of a service: two columns, one on a phone. */
export const FORM_GRID = "grid grid-cols-2 gap-3 max-sm:grid-cols-1";
