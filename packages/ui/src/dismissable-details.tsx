"use client";

import { type RefObject, useEffect, useEffectEvent } from "react";

/**
 * Closes an open `<details>` menu when the pointer goes down outside it or Escape is pressed: a
 * native `<details>` only closes from its own summary, so a filter left open stayed open.
 * Nothing is bound while the menu is closed.
 */
export function useDismiss(ref: RefObject<HTMLDetailsElement | null>, open: boolean, onClose: () => void) {
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      close();
      ref.current?.querySelector("summary")?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [ref, open]);
}
