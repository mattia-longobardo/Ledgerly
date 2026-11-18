"use client";

import { Moon, Sun } from "lucide-react";
import { useTransition } from "react";
import { IconButton } from "@/ui/button";
import { useTheme } from "@/ui/theme-provider";
import { notify } from "@/ui/toast";
import { useShell } from "./shell-context";

/**
 * Flips between light and dark at once, then saves the choice as the user's preference. A rejected
 * save must not throw into the tree (React 19 rethrows a failed async transition): it puts back the
 * preference that was on screen before the toggle — "system" included — and says so in a toast.
 */
export function ThemeToggle() {
  const { labels, saveTheme } = useShell();
  const { preference, setPreference } = useTheme();
  const [, startTransition] = useTransition();

  function toggle() {
    const previous = preference;
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    setPreference(next);
    startTransition(async () => {
      try {
        await saveTheme(next);
      } catch {
        setPreference(previous);
        notify(labels.themeSaveError, "error");
      }
    });
  }

  return (
    <IconButton label={labels.toggleTheme} bordered onClick={toggle}>
      <Moon aria-hidden className="size-3.5 dark:hidden" />
      <Sun aria-hidden className="hidden size-3.5 dark:block" />
    </IconButton>
  );
}
