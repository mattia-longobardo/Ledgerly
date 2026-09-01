import type { ReactNode } from "react";
import { cn } from "../ui/cn";

/**
 * The app's only column system: 4 columns on a phone, 8 on a tablet, 12 from
 * `lg` up. Pages compose with `PageGrid` + `Panel` and never hand-roll a grid,
 * so every screen shares one set of gutters and one set of alignments.
 *
 * The gaps widen with the viewport rather than staying fixed: at 1920 a 16 px
 * gap reads as an accident between two 700 px panels, and at 1024 a 24 px gap
 * eats a column.
 */
const GRID = "grid grid-cols-4 gap-4 md:grid-cols-8 lg:grid-cols-12 xl:gap-5 2xl:gap-6";

export function PageGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn(GRID, "items-start", className)}>{children}</div>;
}

/** 1-12; the value is the span from `lg` up. Below that, see `Panel`. */
export type Span = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/**
 * Static class maps, because Tailwind cannot see an interpolated class name.
 * Written out once here so no page ever has to think about it again.
 */
const LG_SPAN: Record<Span, string> = {
  1: "lg:col-span-1",
  2: "lg:col-span-2",
  3: "lg:col-span-3",
  4: "lg:col-span-4",
  5: "lg:col-span-5",
  6: "lg:col-span-6",
  7: "lg:col-span-7",
  8: "lg:col-span-8",
  9: "lg:col-span-9",
  10: "lg:col-span-10",
  11: "lg:col-span-11",
  12: "lg:col-span-12",
};

const MD_SPAN: Record<number, string> = {
  1: "md:col-span-1",
  2: "md:col-span-2",
  3: "md:col-span-3",
  4: "md:col-span-4",
  5: "md:col-span-5",
  6: "md:col-span-6",
  7: "md:col-span-7",
  8: "md:col-span-8",
};

const LG_START: Record<Span, string> = {
  1: "lg:col-start-1",
  2: "lg:col-start-2",
  3: "lg:col-start-3",
  4: "lg:col-start-4",
  5: "lg:col-start-5",
  6: "lg:col-start-6",
  7: "lg:col-start-7",
  8: "lg:col-start-8",
  9: "lg:col-start-9",
  10: "lg:col-start-10",
  11: "lg:col-start-11",
  12: "lg:col-start-12",
};

export interface PanelProps {
  children: ReactNode;
  /** Column span from `lg` up. Defaults to the full 12. */
  span?: Span;
  /** Column span at `md` (8-column). Defaults to the full 8. */
  spanMd?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  /** Explicit column start from `lg` up, for panels that must not reflow. */
  start?: Span;
  /**
   * Panels are flat by default. `framed` is for the two cases where elevation
   * encodes real hierarchy: a panel you can click through to a detail screen,
   * and a panel that hosts a form. A cluster of identically-boxed cards is
   * banned at this density — it flattens the hierarchy it pretends to build.
   */
  chrome?: "plain" | "framed";
  /** Section heading; rendered as the panel's `<h2>`. */
  title?: string;
  /** Sits opposite the title: a range control, a link, a delta. Never prose. */
  action?: ReactNode;
  /** Used when the panel needs a landmark label but no visible heading. */
  ariaLabel?: string;
  className?: string;
  /** Applied to the body under the header, not to the panel box. */
  bodyClassName?: string;
}

/**
 * One instrument on the page.
 *
 * The panel is a container-query root (`panel` utility), so everything inside
 * it responds to the width the grid handed it. That is what lets the same
 * component sit at 380 px on a phone, 560 px as half a row at 1440, and
 * 1100 px as a full row at 1920 without a single viewport breakpoint.
 */
export function Panel({
  children,
  span = 12,
  spanMd = 8,
  start,
  chrome = "plain",
  title,
  action,
  ariaLabel,
  className,
  bodyClassName,
}: PanelProps) {
  const heading = title !== undefined;

  return (
    <section
      aria-label={ariaLabel}
      className={cn(
        "panel col-span-4",
        MD_SPAN[spanMd],
        LG_SPAN[span],
        start !== undefined && LG_START[start],
        chrome === "framed" &&
          "rounded-md border border-border bg-surface p-4 [--axis-bleed:1rem]",
        className,
      )}
    >
      {(heading || action !== undefined) && (
        <div className="mb-3 flex min-h-8 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {heading && (
            <h2 className="text-caption tracking-wide text-fg-muted uppercase">{title}</h2>
          )}
          {action}
        </div>
      )}
      <div className={cn("min-w-0", bodyClassName)}>{children}</div>
    </section>
  );
}
