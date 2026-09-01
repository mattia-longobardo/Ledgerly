import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { Skeleton, SkeletonChart, SkeletonHero, SkeletonRows } from "@/components/ui/Skeleton";

export default function FundDetailLoading() {
  return (
    <div className="pt-4">
      <Skeleton className="h-4 w-20" />
      <PageGrid className="pt-5">
        <Panel span={7}>
          <SkeletonHero />
          <div className="mt-6">
            <SkeletonChart label="Loading fund history" />
          </div>
        </Panel>
        <Panel span={5} chrome="framed">
          <SkeletonRows rows={4} />
        </Panel>
        <Panel span={7}>
          <SkeletonRows rows={6} />
        </Panel>
      </PageGrid>
    </div>
  );
}
