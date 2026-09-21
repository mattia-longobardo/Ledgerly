"use client";

import { createContext, type ReactNode, useContext, useLayoutEffect, useMemo, useState } from "react";
import { PREFERS_DARK_QUERY, resolveTheme, type ThemePreference } from "@/platform/theme";

interface ThemeState {
  /** The preference on screen: the saved one, or an unsaved choice while its save is in flight. */
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function useTheme(): ThemeState {
  const state = useContext(ThemeContext);
  if (!state) throw new Error("useTheme must be used inside <ThemeProvider>");
  return state;
}

function applyTheme(preference: ThemePreference) {
  const prefersDark = preference === "system" && matchMedia(PREFERS_DARK_QUERY).matches;
  document.documentElement.dataset.theme = resolveTheme(preference, prefersDark);
}

/**
 * The only writer of `data-theme` once the page is interactive (THEME_SCRIPT sets it before first
 * paint). `saved` is the preference the server rendered with; a new one (after a save revalidates
 * the layout) replaces any local choice. While the preference is System it follows the OS setting.
 */
export function ThemeProvider({ saved, children }: { saved: ThemePreference; children: ReactNode }) {
  const [preference, setPreference] = useState(saved);
  const [lastSaved, setLastSaved] = useState(saved);
  if (saved !== lastSaved) {
    setLastSaved(saved);
    setPreference(saved);
  }

  useLayoutEffect(() => {
    applyTheme(preference);
    if (preference !== "system") return;
    const query = matchMedia(PREFERS_DARK_QUERY);
    const onChange = () => applyTheme("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);

  const value = useMemo(() => ({ preference, setPreference }), [preference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
