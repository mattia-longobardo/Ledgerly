"use client";

import { Moon, Sun } from "lucide-react";
import { useTransition } from "react";
import { IconButton } from "@/ui/button";
import type { ThemePreference } from "@/platform/theme";
import { useShell } from "./shell-context";

/** Flips between light and dark immediately, then persists the choice as the user's preference. */
export function ThemeToggle({ onSave }: { onSave: (theme: ThemePreference) => Promise<void> }) {
  const { labels } = useShell();
  const [, startTransition] = useTransition();

  function toggle() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    startTransition(() => onSave(next));
  }

  return (
    <IconButton label={labels.toggleTheme} bordered onClick={toggle}>
      <Moon aria-hidden className="size-3.5 dark:hidden" />
      <Sun aria-hidden className="hidden size-3.5 dark:block" />
    </IconButton>
  );
}
