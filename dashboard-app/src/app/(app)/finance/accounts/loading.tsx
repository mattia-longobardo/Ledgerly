import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";

export default function AccountsLoading() {
  return (
    <div className="pt-4">
      <Skeleton className="h-6 w-28" />
      <Skeleton className="mt-3 h-11 w-full max-w-md" />
      <PageGrid className="pt-5">
        <Panel span={12}>
          <SkeletonRows rows={6} />
        </Panel>
      </PageGrid>
    </div>
  );
}
