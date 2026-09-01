import type { ReactNode } from "react";
import { MoneyValue } from "./MoneyValue";
import { StaleBadge } from "./StaleBadge";
import { cn } from "./cn";
import type { Money } from "@/lib/format";

export interface AccountRowProps {
  name: string;
  value: Money;
  /** Micro-sparkline slot, sized ~64x24. */
  sparkline?: ReactNode;
  capturedAt?: Date | null;
  stale?: boolean;
  /** Sub-account rows; their presence turns the row into a disclosure. */
  children?: ReactNode;
  defaultExpanded?: boolean;
  href?: string;
  onSelect?: () => void;
  /** Nested rendering inside a parent row's disclosure. */
  nested?: boolean;
  className?: string;
}

/**
 * Four shared tracks: disclosure chevron, name, sparkline, value. Every row is
 * a subgrid of these, so the sparklines line up in a column and the figures
 * line up in another however long the account names are. A flex row cannot do
 * this: each row measures itself, so a long name shoves that row's sparkline
 * left and the list reads ragged.
 */
const LIST_COLS = "grid grid-cols-[1rem_minmax(0,1fr)_auto_auto]";
const ROW = "subgrid-cols col-span-4 min-h-11 w-full items-center gap-3 py-2 text-left";

export function AccountList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn(LIST_COLS, "hairline-t", className)}>{children}</div>;
}

function Body({ name, value, sparkline, capturedAt, stale, nested }: AccountRowProps) {
  return (
    <>
      <span className="flex min-w-0 flex-col">
        {/* Nested rows indent the NAME, never the row: padding on a subgrid
            item insets its tracks and undoes the column alignment. */}
        <span
          className={cn(
            "truncate text-body text-fg",
            nested === true && "pl-4 text-body-sm",
          )}
        >
          {name}
        </span>
        {capturedAt !== undefined && (
          <span className={cn(nested === true && "pl-4")}>
            <StaleBadge capturedAt={capturedAt} stale={stale} compact />
          </span>
        )}
      </span>
      <span className="flex items-center justify-end">{sparkline}</span>
      <MoneyValue value={value} size="body" cents="full" className="text-right text-fg" />
    </>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-fg-muted transition-transform duration-150 ease-out group-open:rotate-90"
    >
      <path d="M7.5 4.5 13 10l-5.5 5.5" />
    </svg>
  );
}

/**
 * A disclosure when it has sub-accounts (native `<details>`, so no client JS),
 * otherwise a link, a button, or a plain row. Must be rendered inside an
 * `<AccountList>`, which owns the shared column tracks.
 */
export function AccountRow(props: AccountRowProps) {
  const { children, defaultExpanded, href, onSelect, nested, className } = props;

  if (children !== undefined) {
    return (
      <details
        className={cn("group subgrid-cols col-span-4 hairline-b", className)}
        open={defaultExpanded}
      >
        <summary
          className={cn(
            ROW,
            "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
          )}
        >
          <Chevron />
          <Body {...props} />
        </summary>
        {/* The sub-rows stay on the list's tracks rather than starting a grid
            of their own, so a nested balance sits in exactly the same value
            column as a top-level one. */}
        <div className="subgrid-cols col-span-4 pb-1">{children}</div>
      </details>
    );
  }

  const inner = (
    <>
      <span aria-hidden />
      <Body {...props} />
    </>
  );

  if (href !== undefined) {
    return (
      <a
        href={href}
        className={cn(ROW, "hairline-b transition-colors hover:bg-surface-hover", className)}
      >
        {inner}
      </a>
    );
  }

  if (onSelect !== undefined) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          ROW,
          "hairline-b transition-colors hover:bg-surface-hover active:bg-surface",
          className,
        )}
      >
        {inner}
      </button>
    );
  }

  return <div className={cn(ROW, "hairline-b", className)}>{inner}</div>;
}
