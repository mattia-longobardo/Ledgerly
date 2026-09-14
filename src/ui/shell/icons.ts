import { Component, LayoutDashboard, type LucideIcon, Settings } from "lucide-react";
import type { IconName } from "./nav-types";

/** Nav items carry an icon name (serialisable from Server Components); this maps it to Lucide. */
export const NAV_ICONS: Record<IconName, LucideIcon> = {
  overview: LayoutDashboard,
  settings: Settings,
  components: Component,
};
