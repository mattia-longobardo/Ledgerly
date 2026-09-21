import {
  Banknote,
  CalendarDays,
  ChartPie,
  Landmark,
  LayoutDashboard,
  Percent,
  type LucideIcon,
  Receipt,
  Repeat,
  Settings,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import type { IconName } from "./nav-types";

/** Nav items carry an icon name (serialisable from Server Components); this maps it to Lucide. */
export const NAV_ICONS: Record<IconName, LucideIcon> = {
  overview: LayoutDashboard,
  accounts: Landmark,
  expenses: Receipt,
  budgets: ChartPie,
  funds: TrendingUp,
  interests: Percent,
  pockets: WalletCards,
  subscriptions: Repeat,
  payroll: Banknote,
  timeoff: CalendarDays,
  settings: Settings,
};
