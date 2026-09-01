import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { Skeleton, SkeletonTile } from "@/components/ui/Skeleton";

export default function FundsLoading() {
  return (
    <div className="pt-4">
      <Skeleton className="h-6 w-24" />
      <Skeleton className="mt-3 h-11 w-full max-w-md" />
      <PageGrid className="pt-5">
        <Panel span={12}>
          <div className="@container grid gap-4 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4">
            <SkeletonTile />
            <SkeletonTile />
          </div>
        </Panel>
      </PageGrid>
    </div>
  );
}
