import type { Route } from "next";

export type IconName =
  | "overview"
  | "accounts"
  | "expenses"
  | "budgets"
  | "funds"
  | "interests"
  | "pockets"
  | "subscriptions"
  | "payroll"
  | "settings"
  | "components";

export interface NavLink {
  id: string;
  href: Route;
  label: string;
  icon: IconName;
  group: "finance" | "work" | "system" | "footer";
  mobile: boolean;
}
