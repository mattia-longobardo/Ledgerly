import type { ReactNode } from "react";
import { cn } from "./cn";

export type StatEmphasis = "primary" | "default";

export interface StatTileProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: ReactNode;
  /**
   * `primary` lifts one tile in a cluster by a single background step. Use it
   * for the figure the screen exists to report, and only once per cluster: if
   * every tile is lifted, none of them is.
   *
   * The lift is a background step plus an accent label, never a border or a
   * radius: inside `StatGrid`'s shared seams a rounded box would put two shape
   * systems on one grid, and the light palette has only a single background
   * step, so a fill alone loses the hierarchy that dark mode shows. The accent
   * label is the mark's short bar doing the same job it does in the logo.
   */
  emphasis?: StatEmphasis;
  className?: string;
}

/**
 * Flat by construction. Tiles carry no border of their own: a cluster of
 * identically-boxed cards flattens hierarchy, which is the opposite of what a
 * reading instrument wants. `StatGrid` supplies the hairlines that group them,
 * and `emphasis="primary"` is the only thing that lifts.
 *
 * Each tile is a three-row subgrid of its cluster, so the labels sit on one
 * baseline, the figures on the next and the footnotes on the third — even when
 * one label wraps to two lines and its neighbours do not. Without this the row
 * is visibly ragged at any width where a single label happens to wrap.
 */
export function StatTile({
  label,
  value,
  sub,
  delta,
  emphasis = "default",
  className,
}: StatTileProps) {
  return (
    <div
      className={cn(
        "subgrid-rows row-span-3 gap-1 bg-bg p-4",
        emphasis === "primary" && "bg-surface",
        className,
      )}
    >
      <span
        className={cn(
          "text-caption tracking-wide uppercase",
          emphasis === "primary" ? "text-accent" : "text-fg-muted",
        )}
      >
        {label}
      </span>
      <span className="num self-end text-display-sm leading-tight text-fg">{value}</span>
      {/* Always rendered, so the third subgrid row exists in every tile and the
          cluster keeps one footnote baseline even when a tile has no footnote. */}
      <span className="mt-1 flex flex-wrap items-center gap-2">
        {delta}
        {sub !== undefined && <span className="text-body-sm text-fg-muted">{sub}</span>}
      </span>
    </div>
  );
}

export interface StatGridProps {
  children: ReactNode;
  /**
   * Tiles per row once the container is wide enough. The step down happens on
   * the CLUSTER's width, not the viewport's: the same four figures are 2x2 in a
   * 4-column panel and 1x4 across a full row, and neither placement needs the
   * page to tell it which it is.
   */
  columns?: 2 | 3 | 4;
  className?: string;
}

const WIDE: Record<2 | 3 | 4, string> = {
  2: "@xl:grid-cols-2",
  3: "@xl:grid-cols-2 @3xl:grid-cols-3",
  4: "@xl:grid-cols-2 @3xl:grid-cols-4",
};

/**
 * Groups tiles into one instrument cluster. The hairlines are drawn by the
 * container as a 1px grid gap over the border colour, so every seam is shared
 * and no tile owns a box of its own.
 */
export function StatGrid({ children, columns = 2, className }: StatGridProps) {
  return (
    <div
      className={cn(
        "@container grid auto-rows-auto grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border",
        WIDE[columns],
        className,
      )}
    >
      {children}
    </div>
  );
}
