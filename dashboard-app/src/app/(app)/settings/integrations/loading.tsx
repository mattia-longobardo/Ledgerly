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
 * Kept in lockstep with `settings/integrations/page.tsx`: same single panel,
 * same one section, so nothing jumps on hydrate. Four rows, one per
 * registered provider — Wallet and Trek today, with room for a third.
 */
export default function IntegrationsLoading() {
  return (
    <div className="pt-4">
      <div className="pb-3">
        <Skeleton className="mt-2 h-7 w-32" />
      </div>

      <PageGrid className="pt-5">
        <Panel span={6} bodyClassName="flex flex-col gap-10">
          <SkeletonSection>
            <SkeletonList rows={4} />
          </SkeletonSection>
        </Panel>
      </PageGrid>
    </div>
  );
}
