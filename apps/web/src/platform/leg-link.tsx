"use client";

// The link from an Investments or a Funds row to its leg in Expenses (PERS-651).
import { ButtonLink } from "@ledgerly/ui/button";
import { withParams } from "@ledgerly/ui/url";

/**
 * shortcut: Expenses opens on the leg's day and account, not on the leg itself; upgrade when Expenses
 * takes a movement id in its address.
 */
export function LegLink({
  accountId,
  on,
  label,
  ariaLabel,
  testId,
}: {
  accountId: string;
  on: string;
  label: string;
  ariaLabel: string;
  testId: string;
}) {
  return (
    <ButtonLink
      size="sm"
      variant="ghost"
      href={withParams("/expenses", {}, { from: on, to: on, acc: accountId })}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {label}
    </ButtonLink>
  );
}
