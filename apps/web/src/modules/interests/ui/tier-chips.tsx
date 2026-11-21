import type { ReactNode } from "react";

/** The chips of a rule's tiers, and what follows them (the tax on the rule's page). */
export function TierChips({
  chips,
  children,
}: {
  chips: { rate: string; range: string }[];
  children?: ReactNode;
}) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {chips.map((chip, index) => (
        <span key={index} className="rounded-tag border border-border px-1.5 py-0.5 text-xs">
          <span className="font-semibold">{chip.rate}</span> <span className="text-muted">{chip.range}</span>
        </span>
      ))}
      {children}
    </span>
  );
}
