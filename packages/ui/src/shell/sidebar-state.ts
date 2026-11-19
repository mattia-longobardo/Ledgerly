// No "use client": the web app's layout reads the stored choice on the server with these.

import type { PreferenceKey } from "../preferences";

/** The cookie the browser store mirrors the choice in (`browserPreferences`). */
export const SIDEBAR_COOKIE = "sidebar" satisfies PreferenceKey;

/** "auto" follows the width (full from 1280 px, icons below); an explicit choice wins at any width. */
export type SidebarState = "auto" | "collapsed" | "expanded";

export function parseSidebar(value: string | undefined): SidebarState {
  return value === "collapsed" || value === "expanded" ? value : "auto";
}
