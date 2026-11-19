"use client";

// The choice of a colour (spec §8.3, audit UI-SET-6) and the dot that shows one. The presets are the
// caller's palette — the categories give theirs — so the picker knows no module.
import { NULL_DISPLAY } from "@ledgerly/format/format";
import { cn } from "./cn";

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
 * Presets, a native picker for anything else, and a way back to no colour at all. The hex values
 * are data, not interface text, so they are also the accessible name of each swatch.
 *
 * `id` goes on the native input so the enclosing `Field`'s label names it; the presets carry their
 * own name. The value is controlled, and the hidden input is what a `FormData` submit picks up.
 * `clearLabel` arrives as a string rather than being read from a message namespace here, so the
 * component reads no message catalogue.
 */
export function ColorPicker({
  swatches,
  id,
  name,
  value,
  clearLabel,
  onChange,
  disabled,
}: {
  /** The presets, in order: the first is what the native picker opens on. */
  swatches: readonly string[];
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
      {swatches.map((swatch) => (
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
        value={value ?? swatches[0]}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="focus-ring h-6 w-9 rounded-ctl border border-border bg-card p-0.5"
      />
    </div>
  );
}
