import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { Skeleton, SkeletonChart, SkeletonHero, SkeletonRows } from "@/components/ui/Skeleton";

export default function FinanceLoading() {
  return (
    <div className="pt-4">
      <Skeleton className="h-6 w-28" />
      <Skeleton className="mt-3 h-11 w-full max-w-md" />
      <PageGrid className="pt-5">
        <Panel span={8}>
          <SkeletonHero />
          <div className="mt-6">
            <SkeletonChart label="Loading total wealth" />
          </div>
        </Panel>
        <Panel span={4}>
          <SkeletonRows rows={5} />
        </Panel>
      </PageGrid>
    </div>
  );
}
