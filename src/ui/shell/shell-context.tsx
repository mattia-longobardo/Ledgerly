"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ThemePreference } from "@/platform/theme";
import { SIDEBAR_COOKIE, type SidebarState } from "./sidebar-state";

const WIDE_QUERY = "(min-width: 1280px)";

export interface ShellLabels {
  product: string;
  primary: string;
  groups: { finance: string; work: string; system: string };
  toggleSidebar: string;
  search: string;
  toggleTheme: string;
  themeSaveError: string;
  signOut: string;
  profile: string;
  more: string;
  palette: {
    placeholder: string;
    pages: string;
    records: string;
    payees: string;
    empty: string;
    shortcut: string;
    escape: string;
  };
}

interface ShellState {
  sidebar: SidebarState;
  toggleSidebar: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  labels: ShellLabels;
  /** Saves the theme preference: a Server Action the app layout hands down, so src/ui needs no domain module. */
  saveTheme: (theme: ThemePreference) => Promise<void>;
}

const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const state = useContext(ShellContext);
  if (!state) throw new Error("useShell must be used inside <ShellProvider>");
  return state;
}

export function ShellProvider({
  initialSidebar,
  labels,
  saveTheme,
  children,
}: {
  initialSidebar: SidebarState;
  labels: ShellLabels;
  saveTheme: (theme: ThemePreference) => Promise<void>;
  children: ReactNode;
}) {
  const [sidebar, setSidebar] = useState(initialSidebar);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // The cookie is written outside the state updater: updaters must stay pure (Strict Mode runs them twice).
  const toggleSidebar = useCallback(() => {
    const collapsedNow = sidebar === "collapsed" || (sidebar === "auto" && !matchMedia(WIDE_QUERY).matches);
    const next = collapsedNow ? "expanded" : "collapsed";
    document.cookie = `${SIDEBAR_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    setSidebar(next);
  }, [sidebar]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (event.key === "\\") {
        event.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar]);

  const value = useMemo(
    () => ({ sidebar, toggleSidebar, paletteOpen, setPaletteOpen, labels, saveTheme }),
    [sidebar, toggleSidebar, paletteOpen, labels, saveTheme],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
