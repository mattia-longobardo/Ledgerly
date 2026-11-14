"use client";

import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { cn } from "./cn";

/**
 * An on/off switch: the track is 36 × 20 px, the target around it 44 × 24 px. Off, the track has a
 * border and the knob a 1 px edge, so both states keep a 3:1 outline in the two themes.
 *
 * The name comes from the row's own label: pass its id as `labelledBy`, or a `label` where no
 * visible text names the switch. `controls` is the id of what the switch opens.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  labelledBy,
  describedBy,
  controls,
  disabled,
  id,
  className,
  "data-testid": testId,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  controls?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    // Base UI puts a checkbox beside the switch, hidden from a reader and out of the tab order, to
    // carry the value in a form. It is a 1 × 1 px box all the same: `display: none` keeps it out of
    // the page's targets, and the click the switch hands it still changes it.
    <span className="contents [&>input]:hidden">
      <BaseSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next)}
        disabled={disabled}
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-controls={controls}
        data-testid={testId}
        className={cn(
          "group focus-ring inline-flex h-6 w-11 shrink-0 cursor-default items-center justify-center rounded-full data-[disabled]:opacity-60",
          className,
        )}
      >
        <span className="flex h-5 w-9 items-center rounded-full border border-border bg-track group-data-[checked]:border-primary group-data-[checked]:bg-primary">
          <BaseSwitch.Thumb className="size-4 translate-x-px rounded-full bg-card shadow-[0_0_0_1px_var(--border)] transition-transform data-[checked]:translate-x-[17px] motion-reduce:transition-none" />
        </span>
      </BaseSwitch.Root>
    </span>
  );
}
