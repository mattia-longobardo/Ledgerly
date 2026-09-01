import { Skeleton, SkeletonChart, SkeletonHero, SkeletonRows } from "@/components/ui/Skeleton";

export default function VacationFundLoading() {
  return (
    <div className="pt-4">
      <div className="px-4">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="mt-3 h-11 w-full" />
        <div className="mt-5">
          <SkeletonHero />
        </div>
        <div className="mt-5">
          <SkeletonChart label="Loading vacation fund" />
        </div>
      </div>
      <div className="mt-6">
        <SkeletonRows rows={4} />
      </div>
    </div>
  );
}
