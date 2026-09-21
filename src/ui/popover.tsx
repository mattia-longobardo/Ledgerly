"use client";

import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ReactNode } from "react";

export function Popover({
  trigger,
  triggerLabel,
  children,
}: {
  trigger: ReactNode;
  triggerLabel: string;
  children: ReactNode;
}) {
  return (
    <BasePopover.Root>
      <BasePopover.Trigger
        aria-label={triggerLabel}
        className="focus-ring inline-flex h-[30px] items-center gap-1.5 rounded-ctl border border-border bg-card px-2.5 text-sm hover:bg-hover"
      >
        {trigger}
      </BasePopover.Trigger>
      <BasePopover.Portal>
        <BasePopover.Positioner sideOffset={4} align="start" className="z-30">
          <BasePopover.Popup className="animate-in rounded-lg border border-border bg-card p-1.5 shadow-overlay">
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
