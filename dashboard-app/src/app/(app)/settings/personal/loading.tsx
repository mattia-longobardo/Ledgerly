import type { ReactNode } from "react";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { Skeleton } from "@/components/ui/Skeleton";

/** Mirrors `SettingsSection`: heading column, then the controls column. */
function SkeletonSection({ children }: { children: ReactNode }) {
  return (
    <span className="@container grid gap-x-6 gap-y-3 @2xl:grid-cols-12">
      <span className="block @2xl:col-span-4">
        <Skeleton className="h-2.5 w-28" />
      </span>
      <span className="block min-w-0 @2xl:col-span-8">{children}</span>
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
 * Kept in lockstep with `settings/personal/page.tsx`: same single panel, same
 * split sections, so nothing jumps on hydrate.
 */
export default function PersonalSettingsLoading() {
  return (
    <div className="pt-4">
      <div className="pb-3">
        <Skeleton className="mt-2 h-7 w-28" />
      </div>

      <PageGrid className="pt-5">
        <Panel span={6} bodyClassName="flex flex-col gap-10">
          <SkeletonSection>
            <SkeletonList rows={5} />
          </SkeletonSection>
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
            <Skeleton className="h-12 w-full max-w-xs rounded-md" />
          </SkeletonSection>
        </Panel>
      </PageGrid>
    </div>
  );
}
