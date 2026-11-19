"use client";

import { Toast } from "@base-ui/react/toast";
import { Check, CircleAlert, X } from "lucide-react";

type ToastTone = "success" | "error";

/** One manager for the whole app, so a toast can be raised after a Server Action returns. */
const toastManager = Toast.createToastManager();

/** What a toast can offer beside its message: one thing to do about it, such as "Undo". */
interface ToastAction {
  label: string;
  onClick: () => void;
}

/** A toast with something to press stays long enough to be read and pressed (WCAG 2.2.1). */
const ACTION_TIMEOUT_MS = 8000;

/** The toast whose action is still on offer: there is one "Undo" at a time. */
let actionToast: string | null = null;

/**
 * An error toast is announced assertively; a success one politely.
 *
 * With an `action` the toast carries a button and stays for eight seconds instead of the usual
 * three; the pointer and the focus stop the clock. A new toast with an action closes the one
 * before it, so the action a person presses is always about the last thing they did.
 */
export function notify(message: string, tone: ToastTone = "success", action?: ToastAction): void {
  const priority = tone === "error" ? "high" : "low";
  if (action === undefined) {
    toastManager.add({ title: message, type: tone, priority });
    return;
  }
  if (actionToast !== null) toastManager.close(actionToast);
  const id = toastManager.add({
    title: message,
    type: tone,
    priority,
    timeout: ACTION_TIMEOUT_MS,
    actionProps: {
      children: action.label,
      onClick: () => {
        toastManager.close(id);
        action.onClick();
      },
    },
    onClose: () => {
      if (actionToast === id) actionToast = null;
    },
  });
  actionToast = id;
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
      <Toast.Action className="focus-ring inline-flex min-h-6 shrink-0 items-center rounded-sm px-1 text-base font-semibold text-card underline underline-offset-2" />
      <Toast.Close aria-label={closeLabel} className="focus-ring rounded-sm opacity-70 hover:opacity-100">
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
