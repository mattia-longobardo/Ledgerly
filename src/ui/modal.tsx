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
        <Dialog.Popup
          className="fixed top-1/2 left-1/2 z-50 flex max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 animate-in flex-col gap-4 rounded-modal border border-border bg-card p-5 shadow-overlay"
          style={{ width }}
        >
          <div>
            <Dialog.Title className="text-xl font-semibold">{title}</Dialog.Title>
            {description && (
              <Dialog.Description className="mt-0.5 text-muted">{description}</Dialog.Description>
            )}
          </div>
          {children}
          {footer && <div className="flex items-center justify-end gap-2">{footer}</div>}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
