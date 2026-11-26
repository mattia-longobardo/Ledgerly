"use client";

import { Popover } from "@base-ui/react/popover";
import { Check } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useId, useState } from "react";
import { cn } from "./cn";

/** A category as a picker offers it: in tree order, a sub-category in its group's colour. */
export interface CategoryOption {
  id: string;
  name: string;
  color: string;
  /** 1 for a sub-category, which the pickers indent under its group. */
  depth?: 0 | 1;
  /** The title the option is listed under (the macro, categories-and-rules.md §2.4); none: no title. */
  section?: string;
  /** The macro the option is in, for a picker that offers only some (§3.2). */
  type?: string;
  /** How many movements the option holds, shown at its right (the filter row, audit UI-EXP-2). */
  count?: number;
}

interface PickerItem {
  id: string | null;
  name: string;
  color: string | null;
  depth?: 0 | 1;
  section?: string;
  count?: number;
}

/** The multiple choice of a filter: every id ticked, `null` for "Uncategorised". */
interface CategoryPickerMultiple {
  selectedIds: readonly (string | null)[];
  /** The list's heading, beside «Clear». */
  title: string;
  clearLabel: string;
  onClear: () => void;
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

/** The likeliest categories under their title, in the server's order; an id the list lacks is left out. */
function likelyItems(
  categories: readonly CategoryOption[],
  likely: { ids: readonly string[] | null; title: string } | undefined,
): PickerItem[] {
  return (likely?.ids ?? []).flatMap((id) => {
    const option = categories.find((one) => one.id === id);
    return option ? [{ id, name: option.name, color: option.color, section: likely?.title }] : [];
  });
}

/**
 * What the list shows: the likeliest on top while the search is empty, then what the search leaves;
 * nothing while the likeliest are asked for. `top`: how many of the rows are the likeliest.
 */
function listOf(
  items: readonly PickerItem[],
  categories: readonly CategoryOption[],
  likely: { ids: readonly string[] | null; title: string } | undefined,
  query: string,
): { shown: PickerItem[]; waiting: boolean; top: number } {
  const searching = query.trim() !== "";
  if (!searching && likely?.ids === null) return { shown: [], waiting: true, top: 0 };
  const top = searching ? [] : likelyItems(categories, likely);
  return { shown: [...top, ...searchCategories(items, query)], waiting: false, top: top.length };
}

/** The rows in runs of one title each, in their order: a row with no title is a run of its own. */
function sectionsOf(items: readonly PickerItem[]): { title?: string; items: PickerItem[] }[] {
  const runs: { title?: string; items: PickerItem[] }[] = [];
  for (const item of items) {
    const last = runs.at(-1);
    if (last && item.section !== undefined && last.title === item.section) last.items.push(item);
    else runs.push({ title: item.section, items: [item] });
  }
  return runs;
}

/**
 * The inline category chooser of the design: on a row, and on the selection bar's "Set category".
 * Controlled, because the "E" shortcut has to be able to open the one under the cursor.
 *
 * It opens on a search field: a real taxonomy runs to dozens of categories, and typing a few
 * letters beats scrolling for one. Arrows move through what is left and Enter picks it.
 *
 * Picking "Uncategorised" is a real choice and not a way out of the list: a person can take a
 * category off a movement, and that too is a local edit the sync must not undo (spec §7.2). A
 * caller with nothing to offer for "none" (a budget is always on a category) leaves the label out.
 *
 * With `multiple` (the category filter of Expenses) a pick toggles one option and the list stays
 * open; "Uncategorised" comes last, as a filter lists it.
 */
export function CategoryPicker({
  categories,
  currentId = null,
  multiple,
  uncategorisedCount,
  open,
  onOpenChange,
  onPick,
  uncategorisedLabel,
  searchLabel,
  noMatchLabel,
  triggerLabel,
  triggerId,
  triggerClassName,
  disabled,
  note,
  likely,
  children,
}: {
  categories: readonly CategoryOption[];
  currentId?: string | null;
  multiple?: CategoryPickerMultiple;
  /** The count beside "Uncategorised", when the options show counts. */
  uncategorisedCount?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (categoryId: string | null) => void;
  uncategorisedLabel?: string;
  searchLabel: string;
  noMatchLabel: string;
  triggerLabel: string;
  /** For a form label that names the trigger. */
  triggerId?: string;
  triggerClassName: string;
  disabled?: boolean;
  /** A sentence above the list, about why it offers what it does (`text-sm text-muted`). */
  note?: string;
  /**
   * The likeliest categories, the likeliest first, listed again on top under their title while
   * the search is empty: the ids the server gives, read only, never ranked here. `null` while they
   * are asked for: the list waits for them rather than jump under the pointer when they arrive.
   */
  likely?: { ids: readonly string[] | null; title: string };
  children: ReactNode;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const none: PickerItem[] =
    uncategorisedLabel === undefined
      ? []
      : [{ id: null, name: uncategorisedLabel, color: null, count: uncategorisedCount }];
  const items: PickerItem[] = multiple ? [...categories, ...none] : [...none, ...categories];
  const isSelected = (id: string | null) => (multiple ? multiple.selectedIds.includes(id) : id === currentId);
  const { shown, waiting, top } = listOf(items, categories, likely, query);
  // -1 until an arrow moves: the likeliest category, else the current one, is where the eye starts.
  const start =
    top > 0
      ? 0
      : Math.max(
          0,
          shown.findIndex((item) => isSelected(item.id)),
        );
  const highlighted = Math.min(active < 0 ? start : active, shown.length - 1);

  function change(next: boolean) {
    if (next) {
      setQuery("");
      setActive(-1);
    }
    onOpenChange(next);
  }

  function pick(item: PickerItem) {
    onPick(item.id);
    if (!multiple) onOpenChange(false);
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
        id={triggerId}
        aria-label={triggerLabel}
        title={triggerLabel}
        disabled={disabled}
        className={triggerClassName}
      >
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        {/* Above a modal (z-50): the picker also opens inside dialogs (Add budget, F3). */}
        <Popover.Positioner sideOffset={4} align="start" className="z-[60]">
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
              className="h-7 w-full rounded-tag border border-border bg-card px-2 text-sm placeholder:text-faint focus:border-accent focus:outline-none"
            />
            {note !== undefined && <p className="px-2 text-sm text-muted">{note}</p>}
            {multiple && (
              <div className="flex items-center justify-between px-2 text-micro font-medium tracking-caps text-faint uppercase">
                {multiple.title}
                <button
                  type="button"
                  onClick={multiple.onClear}
                  className="focus-ring rounded-xs text-sm font-medium tracking-normal text-accent normal-case hover:underline"
                >
                  {multiple.clearLabel}
                </button>
              </div>
            )}
            <ul
              id={listId}
              role="listbox"
              aria-label={triggerLabel}
              aria-multiselectable={multiple ? true : undefined}
              className="max-h-[300px] overflow-y-auto"
            >
              {shown.length === 0 && !waiting && (
                <li className="px-2 py-1.5 text-sm text-muted">{noMatchLabel}</li>
              )}
              {sectionsOf(shown).map(({ title, items: inSection }) => {
                const options = inSection.map((item) => {
                  const index = shown.indexOf(item);
                  return (
                    <li
                      key={index}
                      id={optionId(index)}
                      role="option"
                      aria-selected={isSelected(item.id)}
                      onClick={() => pick(item)}
                      onMouseMove={() => setActive(index)}
                      className={cn(
                        "flex h-7 cursor-default items-center gap-2 rounded-tag px-2 text-sm",
                        index === highlighted && "bg-hover",
                        // A sub-category sits under its group (F2.5).
                        item.depth === 1 && "pl-6",
                        !multiple && item.id === currentId && "font-medium",
                      )}
                    >
                      {multiple && <CheckBox checked={isSelected(item.id)} />}
                      <span
                        aria-hidden
                        className={cn("size-2 shrink-0 rounded-xs", item.color === null && "bg-faint")}
                        style={item.color === null ? undefined : { background: item.color }}
                      />
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      {item.count !== undefined && (
                        <span className="text-micro text-muted">{item.count}</span>
                      )}
                    </li>
                  );
                });
                if (title === undefined) return options;
                return (
                  <li key={title} role="group" aria-label={title}>
                    <span
                      aria-hidden
                      className="block px-2 pt-1.5 pb-0.5 text-micro font-medium tracking-caps text-faint uppercase"
                    >
                      {title}
                    </span>
                    <ul role="none">{options}</ul>
                  </li>
                );
              })}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The design's checkbox square, as a glyph: the option itself carries `aria-selected`. */
function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-3.5 shrink-0 place-items-center rounded-sm border",
        checked ? "border-primary bg-primary text-primary-fg" : "border-border2",
      )}
    >
      {checked && <Check className="size-2.5" />}
    </span>
  );
}
