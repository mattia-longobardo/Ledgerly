import type { ReactNode } from "react";
import { cn } from "../ui/cn";

export interface PageHeaderProps {
  title: string;
  /** e.g. the date line, or an "as of" stamp. */
  eyebrow?: ReactNode;
  action?: ReactNode;
  /** A `<SegmentedControl>`; rendered on its own row so it never crowds. */
  segmented?: ReactNode;
  sticky?: boolean;
  className?: string;
}

export function PageHeader({
  title,
  eyebrow,
  action,
  segmented,
  sticky = false,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-3 bg-bg px-4 pt-4 pb-3",
        sticky && "sticky top-0 z-20 hairline-b",
        className,
      )}
    >
      <div className="flex min-h-11 items-center gap-3">
        <div className="min-w-0 flex-1">
          {eyebrow !== undefined && (
            <div className="text-caption tracking-wide text-fg-muted uppercase">{eyebrow}</div>
          )}
          <h1 className="truncate text-heading text-fg">{title}</h1>
        </div>
        {action}
      </div>
      {segmented}
    </header>
  );
}
