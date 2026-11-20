"use client";

import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ReactNode } from "react";

const TRIGGER =
  "focus-ring inline-flex h-[30px] items-center gap-1.5 rounded-ctl border border-border bg-card px-2.5 text-sm hover:bg-hover";

export function Popover({
  trigger,
  triggerLabel,
  triggerClassName = TRIGGER,
  children,
}: {
  trigger: ReactNode;
  /** The trigger's name when its content is not one (an icon); a visible text names it already. */
  triggerLabel?: string;
  triggerClassName?: string;
  children: ReactNode;
}) {
  return (
    <BasePopover.Root>
      <BasePopover.Trigger aria-label={triggerLabel} className={triggerClassName}>
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
