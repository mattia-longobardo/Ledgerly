import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { Skeleton, SkeletonChart, SkeletonRows, SkeletonTile } from "@/components/ui/Skeleton";

export default function BudgetDetailLoading() {
  return (
    <div className="pt-4">
      <Skeleton className="h-6 w-40" />
      <PageGrid className="pt-5">
        <Panel span={12}>
          <div className="grid gap-3 md:grid-cols-4">
            <SkeletonTile />
            <SkeletonTile />
            <SkeletonTile />
            <SkeletonTile />
          </div>
        </Panel>
        <Panel span={12}>
          <SkeletonChart label="Loading remaining by month" />
        </Panel>
        <Panel span={12}>
          <SkeletonRows rows={4} />
        </Panel>
        <Panel span={12}>
          <SkeletonRows rows={3} />
        </Panel>
      </PageGrid>
    </div>
  );
}
