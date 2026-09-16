"use client";

import { NULL_DISPLAY } from "@/platform/format";
import { cn } from "@/ui/cn";

/**
 * The palette of the design's category dots. The hex values are data, not interface text, so they
 * are also the accessible name of each swatch — nothing here needs a message.
 */
export const SWATCHES = [
  "#2563eb",
  "#0ea5e9",
  "#10b981",
  "#84cc16",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#64748b",
] as const;

/** The dot in front of a name in the lists; an uncoloured row keeps the dot's space empty. */
export function ColorDot({ color }: { color: string | null }) {
  if (!color) return <span aria-hidden className="inline-block size-2.5 shrink-0" />;
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-full border border-border"
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * The ColorSwatchPicker of spec §8.3, which F1 did not build: presets, a native picker for
 * anything else, and a way back to no colour at all. It lives here until the design system wants
 * it — `src/ui/` belongs to the orchestrator.
 *
 * `id` goes on the native input so the enclosing `Field`'s label names it; the presets carry their
 * own name. The value is controlled, and the hidden input is what a `FormData` submit picks up.
 * `clearLabel` arrives as a string rather than being read from a message namespace here, so the
 * component stays a design-system piece the way `src/ui/states.tsx` does.
 */
export function ColorSwatchPicker({
  id,
  name,
  value,
  clearLabel,
  onChange,
  disabled,
}: {
  id: string;
  name: string;
  value: string | null;
  clearLabel: string;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name={name} value={value ?? ""} />
      {SWATCHES.map((swatch) => (
        <button
          key={swatch}
          type="button"
          aria-label={swatch}
          aria-pressed={value === swatch}
          disabled={disabled}
          onClick={() => onChange(swatch)}
          className={cn(
            "focus-ring size-6 rounded-full border",
            value === swatch ? "border-fg" : "border-border",
          )}
          style={{ backgroundColor: swatch }}
        />
      ))}
      <button
        type="button"
        aria-label={clearLabel}
        aria-pressed={value === null}
        disabled={disabled}
        onClick={() => onChange(null)}
        className={cn(
          "focus-ring grid size-6 place-items-center rounded-full border bg-card text-muted",
          value === null ? "border-fg" : "border-border",
        )}
      >
        {NULL_DISPLAY}
      </button>
      <input
        id={id}
        type="color"
        value={value ?? "#2563eb"}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="focus-ring h-6 w-9 rounded-ctl border border-border bg-card p-0.5"
      />
    </div>
  );
}
