"use client";

// A dialog that is a form (audit UI-DS-11): the fields, the line of the refusal and the two buttons.
// The caller mounts it only while it is open, so its fields and its error start fresh every time.
import type { FormEvent, ReactNode } from "react";
import { Button } from "./button";
import { Modal } from "./modal";

export function FormDialog({
  onClose,
  title,
  description,
  width,
  onSubmit,
  error,
  pending,
  cancelLabel,
  submitLabel,
  className = "flex flex-col gap-3",
  children,
}: {
  onClose: () => void;
  title: string;
  description?: ReactNode;
  width?: 420 | 440 | 460 | 520;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** What the server refused, said in the person's words; null when nothing was. */
  error: string | null;
  pending: boolean;
  cancelLabel: string;
  submitLabel: string;
  /** The layout of the fields; the error and the buttons span every column of a grid. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      description={description}
      width={width}
    >
      <form onSubmit={onSubmit} noValidate className={className}>
        {children}
        {error && (
          <p role="alert" className="col-span-full text-sm text-neg">
            {error}
          </p>
        )}
        <div className="col-span-full flex justify-end gap-2">
          <Button onClick={onClose}>{cancelLabel}</Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Asks before something goes (audit UI-DS-10); it closes once `onConfirm` says it went. */
export function ConfirmDialog({
  onClose,
  title,
  description,
  cancelLabel,
  confirmLabel,
  onConfirm,
  pending,
}: {
  onClose: () => void;
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      description={description}
      width={420}
      footer={
        <>
          <Button onClick={onClose}>{cancelLabel}</Button>
          <Button variant="danger" disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {null}
    </Modal>
  );
}
