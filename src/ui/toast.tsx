"use client";

import { Toast } from "@base-ui/react/toast";
import { Check, CircleAlert, X } from "lucide-react";

export type ToastTone = "success" | "error";

/** One manager for the whole app, so a toast can be raised after a Server Action returns. */
export const toastManager = Toast.createToastManager();

/** An error toast is announced assertively; a success one politely. */
export function notify(message: string, tone: ToastTone = "success"): void {
  toastManager.add({ title: message, type: tone, priority: tone === "error" ? "high" : "low" });
}

function ToastList({ closeLabel }: { closeLabel: string }) {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      className="flex max-w-full animate-in items-center gap-2.5 rounded-lg bg-fg py-2.5 pr-3 pl-3.5 text-base text-card shadow-overlay"
    >
      {toast.type === "error" ? (
        <CircleAlert aria-hidden className="size-3.5 shrink-0 text-neg" />
      ) : (
        <Check aria-hidden className="size-3.5 shrink-0 text-pos" />
      )}
      <Toast.Title className="min-w-0" />
      <Toast.Close aria-label={closeLabel} className="focus-ring rounded-[4px] opacity-70 hover:opacity-100">
        <X aria-hidden className="size-3.5" />
      </Toast.Close>
    </Toast.Root>
  ));
}

/** Bottom right, sized to each message (at most 420 px); on phones, clear of the 64 px tab bar. */
export function Toaster({ closeLabel }: { closeLabel: string }) {
  return (
    <Toast.Provider toastManager={toastManager} timeout={3200} limit={3}>
      <Toast.Portal>
        <Toast.Viewport className="fixed right-5 bottom-5 z-70 flex w-[min(420px,calc(100vw-40px))] flex-col items-end gap-2 max-md:right-4 max-md:bottom-[84px] max-md:w-[calc(100vw-32px)]">
          <ToastList closeLabel={closeLabel} />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
