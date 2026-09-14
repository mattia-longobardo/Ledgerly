"use client";

import { Toast } from "@base-ui/react/toast";
import { Check, X } from "lucide-react";

/** One manager for the whole app, so a toast can be raised after a Server Action returns. */
export const toastManager = Toast.createToastManager();

export function notify(message: string): void {
  toastManager.add({ title: message });
}

function ToastList({ closeLabel }: { closeLabel: string }) {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      className="flex animate-in items-center gap-2 rounded-lg bg-fg py-2.5 pr-3 pl-3.5 text-base text-card shadow-overlay"
    >
      <Check aria-hidden className="size-3.5 shrink-0 text-pos" />
      <Toast.Title className="flex-1" />
      <Toast.Close aria-label={closeLabel} className="opacity-70 hover:opacity-100">
        <X aria-hidden className="size-3.5" />
      </Toast.Close>
    </Toast.Root>
  ));
}

export function Toaster({ closeLabel }: { closeLabel: string }) {
  return (
    <Toast.Provider toastManager={toastManager} timeout={3200} limit={3}>
      <Toast.Portal>
        <Toast.Viewport className="fixed right-5 bottom-5 z-70 flex w-[min(420px,calc(100vw-40px))] flex-col gap-2">
          <ToastList closeLabel={closeLabel} />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
