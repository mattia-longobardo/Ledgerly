import type { HTMLAttributes, ReactNode, TdHTMLAttributes } from "react";
import { cn } from "./cn";

type Align = "left" | "right";

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full border-collapse text-base", className)} {...props} />;
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-border">{children}</tr>
    </thead>
  );
}

export function Th({
  children,
  align = "left",
  sort,
}: {
  children: ReactNode;
  align?: Align;
  sort?: { direction: "asc" | "desc" | null; onSort: () => void };
}) {
  const ariaSort =
    sort?.direction === "asc" ? "ascending" : sort?.direction === "desc" ? "descending" : undefined;
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn(
        "h-8 px-2 text-sm font-medium whitespace-nowrap text-muted first:pl-4 last:pr-4",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {sort ? (
        <button
          type="button"
          onClick={sort.onSort}
          className={cn(
            "focus-ring inline-flex items-center gap-1 rounded-[4px]",
            sort.direction && "text-fg",
          )}
        >
          {children}
          {sort.direction && (
            <span aria-hidden className="text-micro">
              {sort.direction === "asc" ? "↑" : "↓"}
            </span>
          )}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function Tr({
  selected,
  onClick,
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return (
    <tr
      aria-selected={selected || undefined}
      onClick={onClick}
      className={cn(
        "h-8 border-b border-border hover:bg-hover",
        selected && "bg-sel hover:bg-sel",
        onClick && "cursor-pointer",
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  align = "left",
  muted,
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { align?: Align; muted?: boolean }) {
  return (
    <td
      className={cn(
        "px-2 whitespace-nowrap first:pl-4 last:pr-4",
        align === "right" && "text-right tabular-nums",
        muted && "text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function GroupRow({
  colSpan,
  label,
  summary,
}: {
  colSpan: number;
  label: ReactNode;
  summary?: ReactNode;
}) {
  return (
    <tr className="h-7 border-y border-border bg-bg">
      <th scope="row" colSpan={colSpan} className="px-4 text-left font-normal">
        <div className="flex items-center justify-between">
          <span className="font-semibold">{label}</span>
          {summary && <span className="text-sm text-muted">{summary}</span>}
        </div>
      </th>
    </tr>
  );
}

/** The totals row: `label` is its row header, `children` the remaining cells. */
export function TotalRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <tr className="h-9 bg-bg font-semibold">
      <th scope="row" className="px-2 text-left first:pl-4">
        {label}
      </th>
      {children}
    </tr>
  );
}
