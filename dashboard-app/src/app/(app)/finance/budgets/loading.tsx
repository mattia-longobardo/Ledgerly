import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";

export default function BudgetsLoading() {
  return (
    <div className="pt-4">
      <Skeleton className="h-6 w-24" />
      <PageGrid className="pt-5">
        <Panel span={12}>
          <SkeletonRows rows={4} />
        </Panel>
      </PageGrid>
    </div>
  );
}
