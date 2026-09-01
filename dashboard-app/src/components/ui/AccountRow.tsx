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

const ROW = "flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left";

function Body({ name, value, sparkline, capturedAt, stale, nested }: AccountRowProps) {
  return (
    <>
      <span className="flex min-w-0 flex-col">
        <span className={cn("truncate text-body text-fg", nested === true && "text-body-sm")}>{name}</span>
        {capturedAt !== undefined && (
          <StaleBadge capturedAt={capturedAt} stale={stale} compact />
        )}
      </span>
      <span className="ml-auto flex items-center gap-3">
        {sparkline}
        <MoneyValue value={value} size="body" cents="full" className="text-fg" />
      </span>
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
 * otherwise a link, a button, or a plain row.
 */
export function AccountRow(props: AccountRowProps) {
  const { children, defaultExpanded, href, onSelect, nested, className } = props;
  const padding = nested === true ? "pl-8" : undefined;

  if (children !== undefined) {
    return (
      <details className={cn("group hairline-b", className)} open={defaultExpanded}>
        <summary
          className={cn(
            ROW,
            padding,
            "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
          )}
        >
          <Chevron />
          <Body {...props} />
        </summary>
        <div className="pb-1">{children}</div>
      </details>
    );
  }

  const inner = (
    <>
      <span aria-hidden className="w-4 shrink-0" />
      <Body {...props} />
    </>
  );

  if (href !== undefined) {
    return (
      <a href={href} className={cn(ROW, padding, "hairline-b", className)}>
        {inner}
      </a>
    );
  }

  if (onSelect !== undefined) {
    return (
      <button type="button" onClick={onSelect} className={cn(ROW, padding, "hairline-b", className)}>
        {inner}
      </button>
    );
  }

  return <div className={cn(ROW, padding, "hairline-b", className)}>{inner}</div>;
}
