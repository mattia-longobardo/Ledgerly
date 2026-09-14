"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

export const SIDEBAR_COOKIE = "sidebar";

export interface ShellLabels {
  product: string;
  primary: string;
  groups: { finance: string; work: string; system: string };
  toggleSidebar: string;
  search: string;
  toggleTheme: string;
  signOut: string;
  more: string;
  palette: { placeholder: string; pages: string; empty: string; shortcut: string; escape: string };
}

interface ShellState {
  collapsed: boolean;
  toggleSidebar: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  labels: ShellLabels;
}

const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const state = useContext(ShellContext);
  if (!state) throw new Error("useShell must be used inside <ShellProvider>");
  return state;
}

export function ShellProvider({
  initialCollapsed,
  labels,
  children,
}: {
  initialCollapsed: boolean;
  labels: ShellLabels;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // The cookie is written outside the state updater: updaters must stay pure (Strict Mode runs them twice).
  const toggleSidebar = useCallback(() => {
    const next = !collapsed;
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
    setCollapsed(next);
  }, [collapsed]);

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
    () => ({ collapsed, toggleSidebar, paletteOpen, setPaletteOpen, labels }),
    [collapsed, toggleSidebar, paletteOpen, labels],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
