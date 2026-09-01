"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "./cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Spoken label when the visible one is an abbreviation. */
  srLabel?: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  variant?: "segmented" | "pill";
  fullWidth?: boolean;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  variant = "segmented",
  fullWidth = false,
  className,
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function move(from: number, delta: number) {
    if (options.length === 0) return;
    const next = (from + delta + options.length) % options.length;
    const option = options[next];
    if (option === undefined) return;
    onChange(option.value);
    refs.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        move(index, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        move(index, -1);
        break;
      case "Home":
        event.preventDefault();
        move(0, 0);
        break;
      case "End":
        event.preventDefault();
        move(options.length - 1, 0);
        break;
      default:
        break;
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "flex items-center",
        variant === "segmented"
          ? "gap-0.5 rounded-md border border-border bg-surface p-0.5"
          : "gap-1.5",
        fullWidth && "w-full",
        className,
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "inline-flex min-h-11 flex-1 items-center justify-center px-3 text-body-sm font-medium whitespace-nowrap transition-colors duration-150 ease-out",
              variant === "segmented" ? "rounded-xs" : "rounded-md border",
              selected
                ? cn("bg-accent text-accent-contrast", variant === "pill" && "border-accent")
                : cn(
                    "text-fg-muted",
                    variant === "pill" ? "border-border bg-surface" : "bg-transparent",
                  ),
            )}
          >
            {option.srLabel === undefined ? (
              option.label
            ) : (
              <>
                <span aria-hidden>{option.label}</span>
                <span className="sr-only">{option.srLabel}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
