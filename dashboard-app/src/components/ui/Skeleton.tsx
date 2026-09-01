import { cn } from "./cn";

export interface SkeletonProps {
  className?: string;
}

/** Content-shaped placeholders — spinners are reserved for buttons. */
export function Skeleton({ className }: SkeletonProps) {
  return <span aria-hidden className={cn("block animate-pulse rounded-xs bg-border", className)} />;
}

export interface SkeletonBlockProps extends SkeletonProps {
  label?: string;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span className={cn("block space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </span>
  );
}

export function SkeletonHero({ className }: SkeletonProps) {
  return (
    <span className={cn("block space-y-3", className)}>
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-10 w-56" />
      <Skeleton className="h-5 w-24" />
    </span>
  );
}

export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <span className={cn("block", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="flex min-h-11 items-center gap-3 px-4 py-2 hairline-b">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="ml-auto h-6 w-16" />
          <Skeleton className="h-3 w-20" />
        </span>
      ))}
    </span>
  );
}

export function SkeletonTile({ className }: SkeletonProps) {
  return (
    <span className={cn("block space-y-2 rounded-md border border-border bg-surface p-4", className)}>
      <Skeleton className="h-2.5 w-20" />
      <Skeleton className="h-7 w-28" />
      <Skeleton className="h-3 w-16" />
    </span>
  );
}

export function SkeletonChart({ className, label = "Loading chart" }: SkeletonBlockProps) {
  return (
    <span role="status" aria-label={label} className={cn("block space-y-2", className)}>
      <Skeleton className="h-48 w-full rounded-md" />
      <span className="flex justify-between">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-2.5 w-8" />
        ))}
      </span>
    </span>
  );
}
