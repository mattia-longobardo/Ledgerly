"use client";

import { usePathname, useRouter } from "next/navigation";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

type ViewKey = "overview" | "accounts" | "funds";

const HREF: Record<ViewKey, string> = {
  overview: "/finance",
  accounts: "/finance/accounts",
  funds: "/finance/funds",
};

const OPTIONS = [
  { value: "overview" as const, label: "Overview" },
  { value: "accounts" as const, label: "Accounts" },
  { value: "funds" as const, label: "Funds" },
];

/**
 * Sub-views are routes, not client state: each one is still a server component
 * reading Postgres. The segmented control only navigates — there is no nested
 * navigation anywhere in the app.
 *
 * Budgets and Interests have their own routes and their own left-nav entries
 * but no tab of their own here, the same way this control never grew one for
 * Expenses — `/finance/vacation` is a server-side redirect to `/finance/budgets`
 * now (Phase 6), so it never reaches this client component at all and needs
 * no branch of its own.
 */
export function FinanceTabs() {
  const router = useRouter();
  const pathname = usePathname() ?? "/finance";

  const current: ViewKey = pathname.startsWith("/finance/accounts")
    ? "accounts"
    : pathname.startsWith("/finance/funds")
      ? "funds"
      : "overview";

  return (
    <SegmentedControl
      options={OPTIONS}
      value={current}
      onChange={(next) => router.push(HREF[next])}
      label="Finance view"
      fullWidth
      className="sm:max-w-lg"
    />
  );
}
