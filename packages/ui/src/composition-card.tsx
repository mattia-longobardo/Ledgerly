// The card «composition» (audit UI-ACC-3): a bar of the parts and their list, one grid for every row so
// the amounts and the shares each keep one column. Accounts, Investments and Funds draw it the same;
// every figure is the caller's, already written.
import type { ReactNode } from "react";
import { Card } from "./card";
import { CompositionBar } from "./charts/composition-bar";
import { cn } from "./cn";

interface CompositionPart {
  key: string;
  label: string;
  color: string;
  /** The part's share of the whole, for the bar: 0 when unknown. */
  share: number;
  /** The amount and the share as written: the order the card shows them in. */
  cells: readonly [ReactNode, ReactNode];
  /** Attributes a test or a script reads on the row (`data-*`). */
  data?: Record<`data-${string}`, string>;
}

/** The parts, one grid for every row so the amounts and the shares each keep one column. */
function PartsList({
  parts,
  muted,
  tall,
}: {
  parts: readonly CompositionPart[];
  muted: 0 | 1;
  tall: boolean;
}) {
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 text-sm">
      {parts.map((part) => (
        <li
          key={part.key}
          {...part.data}
          className={cn(
            "col-span-3 grid grid-cols-subgrid items-center border-b border-border last:border-0",
            tall ? "min-h-9" : "min-h-8",
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: part.color }} />
            <span className="truncate">{part.label}</span>
          </span>
          {part.cells.map((cell, index) => (
            <span key={index} className={cn("text-right tabular-nums", index === muted && "text-muted")}>
              {cell}
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}

export function CompositionCard({
  title,
  actions,
  parts,
  empty,
  muted = 1,
  tall = false,
  footer,
  className,
  ...rest
}: {
  title: string;
  /** What sits beside the title: a switch of grouping. */
  actions?: ReactNode;
  parts: readonly CompositionPart[];
  /** Said instead of the bar and the list when there are no parts; without it, both are drawn empty. */
  empty?: string;
  /** Which of the two cells is the quiet one. */
  muted?: 0 | 1;
  tall?: boolean;
  /** Under the list: a note, or the totals the card ends with. */
  footer?: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <Card className={cn("flex min-w-0 flex-col gap-3", className)} {...rest}>
      {actions ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          {actions}
        </div>
      ) : (
        <h2 className="text-lg font-semibold">{title}</h2>
      )}
      {empty !== undefined && parts.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <>
          <CompositionBar parts={parts} />
          <PartsList parts={parts} muted={muted} tall={tall} />
        </>
      )}
      {footer}
    </Card>
  );
}
