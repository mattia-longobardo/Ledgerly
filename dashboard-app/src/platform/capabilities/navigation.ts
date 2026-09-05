import type { Capabilities } from "./resolve";

export interface NavChild {
  href: string;
  label: string;
}
export interface NavItem {
  href: string;
  label: string;
  iconKey: "home" | "finance" | "company" | "settings";
  children?: NavChild[];
}

/**
 * The one place the app decides what its navigation contains.
 *
 * Everything returned here is plain data so a server component can compute it
 * and hand it to the client shell across the serialisation boundary; the shell
 * only maps `iconKey` to an SVG and renders. A link is present only when the
 * capability behind it is present, which is why there is no "coming soon" state
 * anywhere in the shell.
 */
export function buildNavigation(c: Capabilities): NavItem[] {
  const finance: NavChild[] = [
    { href: "/finance", label: "Overview" },
    { href: "/finance/accounts", label: "Accounts" },
    { href: "/finance/funds", label: "Funds" },
  ];
  if (c.features.expenses) finance.push({ href: "/finance/expenses", label: "Expenses" });
  finance.push({ href: "/finance/budgets", label: "Budgets" });
  if (c.features.interests) finance.push({ href: "/finance/interests", label: "Interests" });
  if (c.permissions.has("finance.manage")) finance.push({ href: "/finance/management", label: "Management" });

  const items: NavItem[] = [
    { href: "/", label: "Home", iconKey: "home" },
    { href: "/finance", label: "Finance", iconKey: "finance", children: finance },
  ];
  // Spec §4's page map. Overview needs the payroll feature; Earnings is shown
  // whenever Overview is (the page renders its own "no earnings yet" state, so
  // hiding it would leave a user with nowhere to look); Time Off needs payroll
  // *or* Trek; Payroll needs one of the two payroll write permissions.
  const company: NavChild[] = [];
  if (c.features.payroll) {
    company.push({ href: "/company", label: "Overview" });
    company.push({ href: "/company/earnings", label: "Earnings" });
  }
  if (c.features.payroll || c.features.timeoff) company.push({ href: "/company/time-off", label: "Time Off" });
  if (c.permissions.has("payroll.upload") || c.permissions.has("payroll.review")) {
    company.push({ href: "/company/payroll", label: "Payroll" });
  }
  if (company.length > 0) {
    items.push({ href: "/company", label: "Company", iconKey: "company", children: company });
  }

  const settings: NavChild[] = [
    { href: "/settings/personal", label: "Personal" },
    { href: "/settings/security", label: "Security" },
    { href: "/settings/account", label: "Account" },
    { href: "/settings/integrations", label: "Integrations" },
  ];
  // Administration is the one area whose absence is correct rather than
  // discouraging: a member has nothing to do there.
  if (c.permissions.has("admin.users")) settings.push({ href: "/settings/admin", label: "Administration" });
  items.push({ href: "/settings", label: "Settings", iconKey: "settings", children: settings });
  return items;
}
