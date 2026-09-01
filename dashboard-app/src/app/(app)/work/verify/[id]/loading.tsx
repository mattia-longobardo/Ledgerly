import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

export default function VerifyLoading() {
  return (
    <div className="pt-4">
      <Skeleton className="h-4 w-16" />
      <Skeleton className="mt-3 h-7 w-48" />
      <PageGrid className="pt-5">
        <Panel span={7} className="hidden lg:block">
          <Skeleton className="h-[calc(100dvh-7rem)] w-full rounded-md" />
        </Panel>
        <Panel span={5}>
          <SkeletonText lines={3} />
          <div className="mt-6 flex flex-col gap-4">
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} className="block space-y-2">
                <Skeleton className="h-2.5 w-24" />
                <Skeleton className="h-11 w-full rounded-md" />
              </span>
            ))}
          </div>
        </Panel>
      </PageGrid>
    </div>
  );
}
