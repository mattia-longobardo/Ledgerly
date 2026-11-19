export type IconName =
  | "overview"
  | "accounts"
  | "expenses"
  | "budgets"
  | "funds"
  | "investments"
  | "interests"
  | "pockets"
  | "subscriptions"
  | "payroll"
  | "timeoff"
  | "settings";

export interface NavLink {
  id: string;
  href: string;
  label: string;
  icon: IconName;
  group: "finance" | "work" | "system" | "footer";
  mobile: boolean;
}

/** The groups of the menu, in order (audit UI-NAV-4); the footer's items are drawn apart, under them. */
export const NAV_GROUPS = ["finance", "work", "system"] as const;
