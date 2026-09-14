"use client";

import { Menu } from "@base-ui/react/menu";
import { Ellipsis } from "lucide-react";
import { cn } from "./cn";

export function ActionMenu({
  label,
  items,
}: {
  label: string;
  items: { label: string; onSelect: () => void; danger?: boolean }[];
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={label}
        title={label}
        className="inline-grid size-6 place-items-center rounded-[5px] text-faint hover:bg-hover hover:text-fg"
      >
        <Ellipsis aria-hidden className="size-3.5" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="end" className="z-30">
          <Menu.Popup className="min-w-40 animate-in rounded-lg border border-border bg-card p-1.5 shadow-overlay">
            {items.map((item) => (
              <Menu.Item
                key={item.label}
                onClick={item.onSelect}
                className={cn(
                  "flex h-7 cursor-default items-center rounded-[5px] px-2 text-base data-[highlighted]:bg-hover",
                  item.danger && "text-neg",
                )}
              >
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
