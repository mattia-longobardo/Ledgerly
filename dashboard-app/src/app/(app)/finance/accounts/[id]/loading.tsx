import { PageGrid, Panel } from "@/components/layout/PageGrid";
import {
  Skeleton,
  SkeletonChart,
  SkeletonHero,
  SkeletonRows,
} from "@/components/ui/Skeleton";

export default function AccountDetailLoading() {
  return (
    <div className="pt-4">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-2 h-6 w-48" />
      <PageGrid className="pt-5">
        <Panel span={7}>
          <SkeletonHero />
          <div className="mt-6">
            <SkeletonChart label="Loading balance history" />
          </div>
        </Panel>
        <Panel span={5}>
          <SkeletonRows rows={3} />
        </Panel>
        <Panel span={12}>
          <SkeletonRows rows={6} />
        </Panel>
      </PageGrid>
    </div>
  );
}
