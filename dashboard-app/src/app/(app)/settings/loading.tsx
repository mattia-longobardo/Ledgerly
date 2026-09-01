import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/Skeleton";

/** Mirrors `SettingsSection`: caption heading, then the body. */
function SkeletonSection({ children }: { children: ReactNode }) {
  return (
    <span className="block px-4 lg:px-0">
      <Skeleton className="h-2.5 w-28" />
      <span className="mt-3 block">{children}</span>
    </span>
  );
}

function SkeletonField() {
  return (
    <span className="block space-y-2">
      <Skeleton className="h-2.5 w-24" />
      <Skeleton className="h-11 w-48 rounded-md" />
    </span>
  );
}

/** The Payslip AI fields are full-width: a base URL and a key are long. */
function SkeletonWideField() {
  return (
    <span className="block space-y-2">
      <Skeleton className="h-2.5 w-24" />
      <Skeleton className="h-11 w-full rounded-md" />
    </span>
  );
}

function SkeletonList({ rows }: { rows: number }) {
  return (
    <span className="block hairline-t">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="flex min-h-11 items-center gap-3 py-2 hairline-b">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="ml-auto h-3 w-16" />
        </span>
      ))}
    </span>
  );
}

/**
 * Kept in lockstep with `settings/page.tsx`: same two-column grid at `lg:`,
 * same gutter ownership, same narrow fields — so nothing jumps on hydrate.
 */
export default function SettingsLoading() {
  return (
    <div className="pt-4 pb-8">
      <div className="px-4 pb-3">
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="mt-2 h-7 w-28" />
      </div>

      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 lg:px-4">
        <div className="flex flex-col gap-8 lg:col-start-1 lg:row-start-1">
          <SkeletonSection>
            <span className="block space-y-3">
              <SkeletonField />
              <SkeletonField />
              <Skeleton className="h-11 w-44 rounded-md" />
            </span>
          </SkeletonSection>
          <SkeletonSection>
            <span className="block space-y-3">
              <SkeletonField />
              <Skeleton className="h-11 w-20 rounded-md" />
            </span>
          </SkeletonSection>
          <SkeletonSection>
            <SkeletonList rows={3} />
          </SkeletonSection>
          <SkeletonSection>
            <SkeletonList rows={5} />
          </SkeletonSection>
          <SkeletonSection>
            <span className="block space-y-3">
              <SkeletonWideField />
              <SkeletonWideField />
              <SkeletonWideField />
              <Skeleton className="h-11 w-20 rounded-md" />
            </span>
          </SkeletonSection>
          <SkeletonSection>
            <Skeleton className="h-12 w-full max-w-xs rounded-md" />
          </SkeletonSection>
        </div>

        <div className="mt-8 flex flex-col gap-8 lg:col-start-2 lg:row-start-1 lg:mt-0">
          <SkeletonSection>
            <span className="block">
              <SkeletonList rows={3} />
              <Skeleton className="mt-4 h-11 w-48 rounded-md" />
            </span>
          </SkeletonSection>
          <SkeletonSection>
            <SkeletonList rows={6} />
          </SkeletonSection>
        </div>
      </div>
    </div>
  );
}
