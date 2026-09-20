"use client";

import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  width = 460,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  width?: 420 | 440 | 460 | 520;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-[rgba(10,12,16,0.28)]" />
        {/*
          A form taller than the screen — a rule with several tiers on a 400 px phone — must still
          be saveable: the popup never grows past the viewport, the fields scroll inside it, and the
          title and the buttons stay where they are. `dvh` and not `vh`, or the mobile browser's
          address bar hides the footer again.
        */}
        <Dialog.Popup
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-32px)] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 animate-in flex-col gap-4 rounded-modal border border-border bg-card p-5 shadow-overlay"
          style={{ width }}
        >
          <div>
            <Dialog.Title className="text-xl font-semibold">{title}</Dialog.Title>
            {description && (
              <Dialog.Description className="mt-0.5 text-muted">{description}</Dialog.Description>
            )}
          </div>
          {/* The negative margin gives the focus ring of the first and last field its room back. */}
          <div className="-mx-1 -my-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 py-1">
            {children}
          </div>
          {footer && <div className="flex items-center justify-end gap-2">{footer}</div>}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
