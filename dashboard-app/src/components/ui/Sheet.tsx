"use client";

import { Dialog } from "@base-ui-components/react/dialog";
import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { cn } from "./cn";

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Viewport fraction, e.g. 0.6, or "auto" to hug the content. */
  height?: number | "auto";
  /** Drag the header down to dismiss. */
  draggable?: boolean;
  headerRight?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

const DISMISS_DISTANCE_PX = 96;
const DISMISS_VELOCITY_PX_PER_MS = 0.6;
const EXIT_MS = 200;

/**
 * Vaul-style bottom sheet on Base UI's Dialog. Drag-to-dismiss is implemented
 * here with pointer events (Vaul is not a dependency); only the header strip is
 * a drag surface, so the scrollable body keeps its own gesture.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  height = 0.6,
  draggable = true,
  headerRight,
  footer,
  children,
  className,
}: SheetProps) {
  const popupRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ startY: number; startTime: number; offset: number } | null>(null);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggable || event.button !== 0) return;
    drag.current = { startY: event.clientY, startTime: event.timeStamp, offset: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    const el = popupRef.current;
    if (el) el.style.transition = "none";
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const state = drag.current;
    const el = popupRef.current;
    if (!state || !el) return;
    const raw = event.clientY - state.startY;
    // Upward drag resists instead of lifting the sheet off the bottom edge.
    state.offset = raw < 0 ? raw / 4 : raw;
    el.style.transform = `translateY(${state.offset}px)`;
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const state = drag.current;
    const el = popupRef.current;
    drag.current = null;
    if (!state || !el) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const elapsed = Math.max(event.timeStamp - state.startTime, 1);
    const velocity = state.offset / elapsed;
    const dismiss =
      state.offset > DISMISS_DISTANCE_PX || velocity > DISMISS_VELOCITY_PX_PER_MS;

    if (!dismiss) {
      el.style.transition = `transform ${EXIT_MS}ms ease-out`;
      el.style.transform = "";
      return;
    }

    el.style.transition = `transform ${EXIT_MS}ms ease-out`;
    el.style.transform = "translateY(100%)";
    window.setTimeout(() => {
      el.style.transition = "";
      el.style.transform = "";
      onOpenChange(false);
    }, EXIT_MS);
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-scrim backdrop-blur-sm transition-opacity duration-200 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          ref={popupRef}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden rounded-t-lg border-t border-border bg-surface-raised shadow-overlay outline-none",
            "transition-transform duration-200 ease-out data-ending-style:translate-y-full data-starting-style:translate-y-full",
            className,
          )}
          style={{
            height: height === "auto" ? undefined : `${Math.round(height * 100)}dvh`,
            maxHeight: "92dvh",
          }}
        >
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            style={draggable ? { touchAction: "none" } : undefined}
            className={cn("shrink-0 select-none", draggable && "cursor-grab active:cursor-grabbing")}
          >
            {draggable && (
              <div className="flex justify-center pt-2 pb-1">
                <span aria-hidden className="h-1 w-10 rounded-md bg-border" />
              </div>
            )}
            <div className="flex min-h-11 items-center gap-2 px-4 pb-3">
              <Dialog.Title className="min-w-0 flex-1 truncate text-heading-sm text-fg">
                {title}
              </Dialog.Title>
              {headerRight}
              <Dialog.Close
                aria-label="Close"
                className="-mr-2 inline-flex size-11 items-center justify-center rounded-xs text-fg-muted"
              >
                <svg
                  aria-hidden
                  viewBox="0 0 20 20"
                  width={18}
                  height={18}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                >
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </Dialog.Close>
            </div>
            {description !== undefined && (
              <Dialog.Description className="px-4 pb-3 text-body-sm text-fg-muted">
                {description}
              </Dialog.Description>
            )}
            <div className="hairline-b" />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
            {children}
          </div>

          {footer !== undefined && (
            <div className="safe-b shrink-0 hairline-t bg-surface px-4 pt-3 pb-3">{footer}</div>
          )}
          {footer === undefined && <div className="safe-b shrink-0" />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
