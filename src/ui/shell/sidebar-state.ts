// No "use client": the app layout reads the cookie on the server with these.

export const SIDEBAR_COOKIE = "sidebar";

/** "auto" follows the width (full from 1280 px, icons below); an explicit choice wins at any width. */
export type SidebarState = "auto" | "collapsed" | "expanded";

export function parseSidebar(value: string | undefined): SidebarState {
  return value === "collapsed" || value === "expanded" ? value : "auto";
}
