"use client";

import { Moon, Sun } from "lucide-react";
import { useTransition } from "react";
import { IconButton } from "@/ui/button";
import { THEME_COOKIE, type ThemePreference } from "@/platform/theme";
import { notify } from "@/ui/toast";
import { useShell } from "./shell-context";

function writeThemeCookie(theme: "light" | "dark") {
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Flips between light and dark immediately, then persists the choice as the user's preference. A
 * rejected save must not throw into the tree (React 19 rethrows a failed async transition, and
 * there is no error boundary above the shell): it reverts the optimistic attribute and cookie and
 * tells the user via a toast instead.
 */
export function ThemeToggle({ onSave }: { onSave: (theme: ThemePreference) => Promise<void> }) {
  const { labels } = useShell();
  const [, startTransition] = useTransition();

  function toggle() {
    const previous: "light" | "dark" = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const next: "light" | "dark" = previous === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    writeThemeCookie(next);
    startTransition(async () => {
      try {
        await onSave(next);
      } catch {
        document.documentElement.dataset.theme = previous;
        writeThemeCookie(previous);
        notify(labels.themeSaveError);
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
