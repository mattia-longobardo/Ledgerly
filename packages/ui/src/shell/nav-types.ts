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
  group: "everyday" | "savings" | "work" | "system" | "footer";
  mobile: boolean;
}

/**
 * The groups of the menu, in order (audit UI-NAV-4; decision D2: «Ogni giorno», «Risparmi e investimenti»,
 * «Lavoro»); the footer's items are drawn apart, under them.
 */
export const NAV_GROUPS = ["everyday", "savings", "work", "system"] as const;
