"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "./cn";

export interface ToastProps {
  open: boolean;
  message: string;
  detail?: string;
  onOpenChange: (open: boolean) => void;
  /** Renders the Undo affordance and its countdown. */
  onUndo?: () => void;
  undoLabel?: string;
  /** Milliseconds before auto-dismiss; the spec's Undo window is 10 s. */
  duration?: number;
  /** Lift above the 56 px bottom tab bar. */
  aboveTabBar?: boolean;
  className?: string;
}

export function Toast({
  open,
  message,
  detail,
  onOpenChange,
  onUndo,
  undoLabel = "Undo",
  duration = 10_000,
  aboveTabBar = true,
  className,
}: ToastProps) {
  const [remaining, setRemaining] = useState(Math.ceil(duration / 1000));
  const pausedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setRemaining(Math.ceil(duration / 1000));
      return;
    }
    let left = Math.ceil(duration / 1000);
    setRemaining(left);
    const id = window.setInterval(() => {
      if (pausedRef.current) return;
      left -= 1;
      setRemaining(left);
      if (left <= 0) {
        window.clearInterval(id);
        onOpenChange(false);
      }
    }, 1000);
    return () => window.clearInterval(id);
    // `onOpenChange` is intentionally excluded: a new identity each render
    // would restart the Undo window on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, duration]);

  if (!open) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      onPointerEnter={() => {
        pausedRef.current = true;
      }}
      onPointerLeave={() => {
        pausedRef.current = false;
      }}
      onFocusCapture={() => {
        pausedRef.current = true;
      }}
      onBlurCapture={() => {
        pausedRef.current = false;
      }}
      style={aboveTabBar ? { paddingBottom: "calc(3.5rem + env(safe-area-inset-bottom, 0px))" } : undefined}
      className={cn("pointer-events-none fixed inset-x-0 bottom-0 z-50 px-4 pb-4", className)}
    >
      <div className="pointer-events-auto mx-auto flex max-w-md items-center gap-3 rounded-md border border-border bg-surface-raised px-4 py-3 shadow-overlay">
        <span aria-hidden className="text-body font-semibold text-positive">
          ✓
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-sm text-fg">{message}</span>
          {detail !== undefined && (
            <span className="block truncate text-caption text-fg-muted">{detail}</span>
          )}
        </span>
        {onUndo !== undefined && (
          <button
            type="button"
            onClick={() => {
              onUndo();
              onOpenChange(false);
            }}
            className="-my-2 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xs px-2 text-body-sm font-medium text-accent"
          >
            {undoLabel}
            <span aria-hidden className="num text-caption text-fg-muted">
              {Math.max(remaining, 0)}s
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Dismiss"
          className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-xs text-fg-muted"
        >
          <svg aria-hidden viewBox="0 0 20 20" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </div>
    </div>
  );
}
