"use client";

import { usePathname, useRouter } from "next/navigation";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

type ViewKey = "overview" | "funds" | "vacation";

const HREF: Record<ViewKey, string> = {
  overview: "/finance",
  funds: "/finance/funds",
  vacation: "/finance/vacation",
};

const OPTIONS = [
  { value: "overview" as const, label: "Overview" },
  { value: "funds" as const, label: "Funds" },
  { value: "vacation" as const, label: "Vacation fund" },
];

/**
 * Sub-views are routes, not client state: each one is still a server component
 * reading Postgres. The segmented control only navigates — there is no nested
 * navigation anywhere in the app.
 */
export function FinanceTabs() {
  const router = useRouter();
  const pathname = usePathname() ?? "/finance";

  const current: ViewKey = pathname.startsWith("/finance/funds")
    ? "funds"
    : pathname.startsWith("/finance/vacation")
      ? "vacation"
      : "overview";

  return (
    <SegmentedControl
      options={OPTIONS}
      value={current}
      onChange={(next) => router.push(HREF[next])}
      label="Finance view"
      fullWidth
    />
  );
}
