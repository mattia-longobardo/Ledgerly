import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { Skeleton, SkeletonRows, SkeletonTile } from "@/components/ui/Skeleton";

export default function WorkLoading() {
  return (
    <div className="pt-4">
      <Skeleton className="h-6 w-20" />
      <PageGrid className="pt-5">
        <Panel span={12}>
          <div className="grid grid-cols-2 gap-3 @xl:grid-cols-2 @3xl:grid-cols-4">
            <SkeletonTile />
            <SkeletonTile />
            <SkeletonTile />
            <SkeletonTile />
          </div>
        </Panel>
        <Panel span={7}>
          <SkeletonRows rows={6} />
        </Panel>
        <Panel span={5}>
          <SkeletonRows rows={6} />
        </Panel>
      </PageGrid>
    </div>
  );
}
