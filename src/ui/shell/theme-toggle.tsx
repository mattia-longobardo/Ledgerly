"use client";

import { Moon, Sun } from "lucide-react";
import { useTransition } from "react";
import { IconButton } from "@/ui/button";
import { parseTheme, THEME_COOKIE, type ThemePreference } from "@/platform/theme";
import { notify } from "@/ui/toast";
import { useShell } from "./shell-context";

function writeThemeCookie(theme: ThemePreference) {
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
}

/** The user's actual saved preference — "system" included — read back from the cookie set by a
 *  previous save (or by the server on first render). Never derived from the rendered attribute,
 *  which is always resolved to a concrete light/dark and would silently lose "system" on revert. */
function readThemePreference(): ThemePreference {
  const match = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]*)`));
  return parseTheme(match?.[1]);
}

/**
 * Flips between light and dark immediately, then persists the choice as the user's preference. A
 * rejected save must not throw into the tree (React 19 rethrows a failed async transition, and
 * there is no error boundary above the shell): it reverts the rendered attribute and the cookie to
 * exactly what they were before the toggle — including "system", which the rendered attribute alone
 * cannot express — and tells the user via a toast instead.
 */
export function ThemeToggle({ onSave }: { onSave: (theme: ThemePreference) => Promise<void> }) {
  const { labels } = useShell();
  const [, startTransition] = useTransition();

  function toggle() {
    const previousPreference = readThemePreference();
    const previousAttribute: "light" | "dark" =
      document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const next: "light" | "dark" = previousAttribute === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    writeThemeCookie(next);
    startTransition(async () => {
      try {
        await onSave(next);
      } catch {
        document.documentElement.dataset.theme = previousAttribute;
        writeThemeCookie(previousPreference);
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
