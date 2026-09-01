import { Skeleton, SkeletonChart, SkeletonHero, SkeletonRows } from "@/components/ui/Skeleton";

export default function FundDetailLoading() {
  return (
    <div className="px-4 pt-4">
      <Skeleton className="h-4 w-20" />
      <div className="mt-4">
        <SkeletonHero />
      </div>
      <div className="mt-6">
        <SkeletonChart label="Loading fund history" />
      </div>
      <div className="-mx-4 mt-6">
        <SkeletonRows rows={6} />
      </div>
    </div>
  );
}
