"use client";

import { Popover } from "@base-ui/react/popover";
import { type KeyboardEvent, type ReactNode, useId, useState } from "react";
import { cn } from "@/ui/cn";
import type { CategoryOption } from "./view";

interface PickerItem {
  id: string | null;
  name: string;
  color: string | null;
  depth?: 0 | 1;
}

/** Case and accents aside: "caffe" finds "Caffè". */
function folded(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

/**
 * The rows a search leaves, in the tree's own order. A group that matches brings its
 * sub-categories along, and a sub-category that matches brings its group, so a row is never shown
 * without the group it sits under. The list arrives in tree order (a group, then its children).
 */
export function searchCategories(items: readonly PickerItem[], query: string): PickerItem[] {
  const needle = folded(query.trim());
  if (needle === "") return [...items];
  const parentOf = new Map<PickerItem, PickerItem>();
  let group: PickerItem | null = null;
  for (const item of items) {
    if (item.depth === 1 && group) parentOf.set(item, group);
    else group = item;
  }
  const matches = new Set(items.filter((item) => folded(item.name).includes(needle)));
  return items.filter((item) => {
    if (matches.has(item)) return true;
    const parent = parentOf.get(item);
    if (parent && matches.has(parent)) return true;
    return item.depth !== 1 && items.some((child) => parentOf.get(child) === item && matches.has(child));
  });
}

/**
 * The inline category chooser of the design: on a row, and on the selection bar's "Set category".
 * Controlled, because the "E" shortcut has to be able to open the one under the cursor.
 *
 * It opens on a search field: a real taxonomy runs to dozens of categories, and typing a few
 * letters beats scrolling for one. Arrows move through what is left and Enter picks it.
 *
 * Picking "Uncategorised" is a real choice and not a way out of the list: a person can take a
 * category off a movement, and that too is a local edit the sync must not undo (spec §7.2).
 */
export function CategoryPicker({
  categories,
  currentId,
  open,
  onOpenChange,
  onPick,
  uncategorisedLabel,
  searchLabel,
  noMatchLabel,
  triggerLabel,
  triggerClassName,
  disabled,
  children,
}: {
  categories: readonly CategoryOption[];
  currentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (categoryId: string | null) => void;
  uncategorisedLabel: string;
  searchLabel: string;
  noMatchLabel: string;
  triggerLabel: string;
  triggerClassName: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const items: PickerItem[] = [{ id: null, name: uncategorisedLabel, color: null }, ...categories];
  const shown = searchCategories(items, query);
  const highlighted = Math.min(active, shown.length - 1);

  function change(next: boolean) {
    if (next) {
      setQuery("");
      // The current category is where the eye starts, as in the menu this replaced.
      setActive(
        Math.max(
          0,
          items.findIndex((item) => item.id === currentId),
        ),
      );
    }
    onOpenChange(next);
  }

  function pick(item: PickerItem) {
    onPick(item.id);
    onOpenChange(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive(Math.min(shown.length - 1, Math.max(0, highlighted + step)));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = shown[highlighted];
      if (item) pick(item);
    }
  }

  const optionId = (index: number) => `${listId}-${index}`;

  return (
    <Popover.Root open={open} onOpenChange={change}>
      <Popover.Trigger
        aria-label={triggerLabel}
        title={triggerLabel}
        disabled={disabled}
        className={triggerClassName}
      >
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={4} align="start" className="z-40">
          <Popover.Popup
            aria-label={triggerLabel}
            className="flex w-[240px] animate-in flex-col gap-1.5 rounded-lg border border-border bg-card p-1.5 shadow-overlay"
          >
            <input
              type="search"
              role="combobox"
              aria-label={searchLabel}
              placeholder={searchLabel}
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={shown.length > 0 ? optionId(highlighted) : undefined}
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              className="h-7 w-full rounded-[5px] border border-border bg-card px-2 text-sm placeholder:text-faint focus:border-accent focus:outline-none"
            />
            <ul
              id={listId}
              role="listbox"
              aria-label={triggerLabel}
              className="max-h-[300px] overflow-y-auto"
            >
              {shown.length === 0 && <li className="px-2 py-1.5 text-sm text-muted">{noMatchLabel}</li>}
              {shown.map((item, index) => (
                <li
                  key={item.id ?? "none"}
                  id={optionId(index)}
                  role="option"
                  aria-selected={item.id === currentId}
                  onClick={() => pick(item)}
                  onMouseMove={() => setActive(index)}
                  className={cn(
                    "flex h-7 cursor-default items-center gap-2 rounded-[5px] px-2 text-sm",
                    index === highlighted && "bg-hover",
                    // A sub-category sits under its group (F2.5).
                    item.depth === 1 && "pl-6",
                    item.id === currentId && "font-medium",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn("size-2 shrink-0 rounded-[2px]", item.color === null && "bg-faint")}
                    style={item.color === null ? undefined : { background: item.color }}
                  />
                  <span className="min-w-0 truncate">{item.name}</span>
                </li>
              ))}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
