import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { Skeleton, SkeletonChart, SkeletonHero, SkeletonRows } from "@/components/ui/Skeleton";

export default function VacationFundLoading() {
  return (
    <div className="pt-4">
      <Skeleton className="h-6 w-36" />
      <Skeleton className="mt-3 h-11 w-full max-w-md" />
      <PageGrid className="pt-5">
        <Panel span={5}>
          <SkeletonHero />
          <div className="mt-6">
            <SkeletonChart label="Loading vacation fund" />
          </div>
        </Panel>
        <Panel span={7} chrome="framed">
          <Skeleton className="h-11 w-full rounded-md" />
        </Panel>
        <Panel span={7}>
          <SkeletonRows rows={4} />
        </Panel>
      </PageGrid>
    </div>
  );
}
