"use client";

import { Menu } from "@base-ui/react/menu";
import type { ReactNode } from "react";
import { cn } from "@/ui/cn";
import type { CategoryOption } from "./view";

/**
 * The inline category chooser of the design: on a row, and on the selection bar's "Set category".
 * Controlled, because the "E" shortcut has to be able to open the one under the cursor.
 *
 * Picking "Uncategorised" is a real choice and not a way out of the menu: a person can take a
 * category off a movement, and that too is a local edit the sync must not undo (spec §7.2).
 */
export function CategoryPicker({
  categories,
  currentId,
  open,
  onOpenChange,
  onPick,
  uncategorisedLabel,
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
  triggerLabel: string;
  triggerClassName: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const items: { id: string | null; name: string; color: string | null }[] = [
    { id: null, name: uncategorisedLabel, color: null },
    ...categories,
  ];

  return (
    <Menu.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Menu.Trigger
        aria-label={triggerLabel}
        title={triggerLabel}
        disabled={disabled}
        className={triggerClassName}
      >
        {children}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="start" className="z-40">
          <Menu.Popup className="max-h-[300px] w-[200px] animate-in overflow-y-auto rounded-lg border border-border bg-card p-1.5 shadow-overlay">
            {items.map((item) => (
              <Menu.Item
                key={item.id ?? "none"}
                onClick={() => onPick(item.id)}
                className={cn(
                  "flex h-7 cursor-default items-center gap-2 rounded-[5px] px-2 text-sm data-[highlighted]:bg-hover",
                  item.id === currentId && "font-medium",
                )}
              >
                <span
                  aria-hidden
                  className={cn("size-2 shrink-0 rounded-[2px]", item.color === null && "bg-faint")}
                  style={item.color === null ? undefined : { background: item.color }}
                />
                <span className="min-w-0 truncate">{item.name}</span>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
