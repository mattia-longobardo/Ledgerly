import type { SVGProps } from "react";
import { cn } from "./cn";

/**
 * The mark: a monogram F standing on a chart axis. The stem and long bar take
 * `currentColor` so the mark inherits the surrounding theme; the short bar is
 * always the accent — it is the "current value" read, and the one fixed point
 * of the identity. The axis rule overshoots the glyph on both sides, which is
 * what stops it reading as a third arm of the letter.
 *
 * Geometry is shared with public/brand/*.svg — change both together.
 */
export function BrandMark({ className, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden
      className={cn("shrink-0", className)}
      {...rest}
    >
      <rect x="3" y="40" width="42" height="2.5" fill="currentColor" opacity="0.45" />
      <rect x="8" y="6" width="6" height="30" fill="currentColor" />
      <rect x="8" y="6" width="27" height="6" fill="currentColor" />
      <rect x="8" y="18" width="19" height="6" className="fill-accent" />
    </svg>
  );
}

/** Mark plus wordmark. The weight split carries the hierarchy, never colour alone. */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5 text-fg", className)}>
      <BrandMark className="h-5 w-5" />
      {/* A product name is not prose: machine translation must leave it alone. */}
      <span translate="no" className="text-body-sm tracking-tight">
        <span className="font-semibold">Finance</span>
        <span className="text-fg-muted"> Dashboard</span>
      </span>
    </span>
  );
}
