import type { ReactNode } from "react";
import { cn } from "../ui/cn";

export interface PageHeaderProps {
  title: string;
  /** e.g. the date line, an "as of" stamp, or a back link. */
  eyebrow?: ReactNode;
  action?: ReactNode;
  /** A `<SegmentedControl>`; rendered on its own row so it never crowds. */
  segmented?: ReactNode;
  sticky?: boolean;
  className?: string;
}

/**
 * The page's one `<h1>`. It carries no gutter of its own: the shell owns the
 * horizontal padding and publishes it as `--axis-bleed`, so the rule under the
 * title reaches the viewport edge at 360 px and at 2560 px without this
 * component knowing either number.
 */
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
        "flex flex-col gap-3 bg-bg pt-5 pb-4",
        !segmented && "axis-rule",
        sticky && "sticky top-0 z-20 hairline-b",
        className,
      )}
    >
      <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          {eyebrow !== undefined && (
            <div className="text-caption tracking-widest text-fg-muted uppercase">{eyebrow}</div>
          )}
          <h1 className="truncate text-heading font-semibold tracking-tight text-fg lg:text-display-sm">
            {title}
          </h1>
        </div>
        {action}
      </div>
      {segmented}
    </header>
  );
}
