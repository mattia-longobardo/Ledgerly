"use client";

import { useEffect, useState } from "react";
import { SegmentedControl } from "./ui/SegmentedControl";
import { THEME_STORAGE_KEY } from "./ThemeScript";
import { cn } from "./ui/cn";

export type ThemeMode = "system" | "light" | "dark";

const ORDER: readonly ThemeMode[] = ["system", "light", "dark"];

function readStored(): ThemeMode {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    // Private mode / blocked storage: fall back to following the system.
  }
  return "system";
}

function apply(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
  try {
    if (mode === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Preference simply does not persist.
  }
}

function Glyph({ mode }: { mode: ThemeMode }) {
  const common = {
    "aria-hidden": true,
    viewBox: "0 0 20 20",
    width: 18,
    height: 18,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (mode === "light") {
    return (
      <svg {...common}>
        <circle cx={10} cy={10} r={3.5} />
        <path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6 16 16M16 4l-1.4 1.4M5.4 14.6 4 16" />
      </svg>
    );
  }
  if (mode === "dark") {
    return (
      <svg {...common}>
        <path d="M16 11.5A6.5 6.5 0 0 1 8.5 4a6.5 6.5 0 1 0 7.5 7.5Z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x={2.5} y={3.5} width={15} height={10} rx={2} />
      <path d="M7 16.5h6" />
    </svg>
  );
}

export interface ThemeToggleProps {
  variant?: "icon" | "segmented";
  className?: string;
}

export function ThemeToggle({ variant = "icon", className }: ThemeToggleProps) {
  const [mode, setMode] = useState<ThemeMode | null>(null);

  useEffect(() => {
    setMode(readStored());
  }, []);

  const current = mode ?? "system";

  function set(next: ThemeMode) {
    setMode(next);
    apply(next);
  }

  if (variant === "segmented") {
    return (
      <SegmentedControl
        options={[
          { value: "system", label: "System" },
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
        value={current}
        onChange={set}
        label="Colour theme"
        className={className}
      />
    );
  }

  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] ?? "system";

  return (
    <button
      type="button"
      onClick={() => set(next)}
      aria-label={`Theme: ${current}. Switch to ${next}.`}
      className={cn(
        "inline-flex size-11 items-center justify-center rounded-md border border-border bg-surface text-fg-muted",
        className,
      )}
    >
      <Glyph mode={current} />
    </button>
  );
}
