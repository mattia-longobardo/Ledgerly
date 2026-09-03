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
 * The vacation fund keeps its own route but no tab of its own until Phase 6;
 * it stays reachable from a link on the Funds page.
 */
export function FinanceTabs() {
  const router = useRouter();
  const pathname = usePathname() ?? "/finance";

  const current: ViewKey = pathname.startsWith("/finance/accounts")
    ? "accounts"
    : pathname.startsWith("/finance/funds") ||
        pathname.startsWith("/finance/vacation")
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
