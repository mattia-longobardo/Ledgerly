"use client";

import { useEffect, useState } from "react";

/**
 * What the shortcuts keep their hands off. Fields and popups are the obvious ones; every kind of
 * button is here because Space is the way a button is activated, so intercepting it would mean a
 * category chip, a row menu, a sortable heading or a `<summary>` silently doing nothing while a
 * row nobody pointed at gets selected instead.
 */
const FOREIGN_KEYBOARD = [
  "input",
  "textarea",
  "select",
  "button",
  "summary",
  "a[href]",
  "[role='button']",
  "[role='link']",
  "[contenteditable]",
  "[role='dialog']",
  "[role='menu']",
].join(", ");

/** A bare key pressed outside every field, control and popup. */
function isOurs(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  return !(event.target instanceof Element && event.target.closest(FOREIGN_KEYBOARD));
}

/**
 * The prototype's shortcuts, for real (spec §8.4 point 2): J/K move a cursor over the rows and focus
 * the row's element (`domId`), Space toggles the row, E edits its category. Bound to the document so
 * they work the moment the page is read, and ignored while the caret is in a field, a control owns
 * its own keys or a popup owns the keyboard — Space is how a button is pressed, a menu answers its
 * own arrows, and ⌘K is not ours to intercept.
 */
export function useRowKeyboard(
  ids: readonly string[],
  domId: (id: string) => string,
  actions: { toggle: (id: string) => void; edit: (id: string) => void },
): void {
  const [cursor, setCursor] = useState(-1);

  useEffect(() => {
    if (cursor < 0 || cursor >= ids.length) return;
    document.getElementById(domId(ids[cursor]))?.focus();
  }, [cursor, ids, domId]);

  const { toggle, edit } = actions;
  useEffect(() => {
    function handle(event: KeyboardEvent) {
      if (ids.length === 0 || !isOurs(event)) return;
      const key = event.key.toLowerCase();
      if (key === "j" || key === "k") {
        event.preventDefault();
        setCursor((current) => {
          const next = current < 0 ? 0 : current + (key === "j" ? 1 : -1);
          return Math.min(ids.length - 1, Math.max(0, next));
        });
        return;
      }
      if (cursor < 0 || cursor >= ids.length) return;
      const id = ids[cursor];
      if (key === " ") {
        event.preventDefault();
        toggle(id);
        return;
      }
      if (key === "e") {
        event.preventDefault();
        edit(id);
      }
    }
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [cursor, ids, toggle, edit]);
}
