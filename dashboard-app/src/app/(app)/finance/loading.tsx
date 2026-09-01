import { Skeleton, SkeletonChart, SkeletonRows } from "@/components/ui/Skeleton";

export default function FinanceLoading() {
  return (
    <div className="pt-4">
      <div className="px-4">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="mt-3 h-11 w-full" />
      </div>
      <div className="mt-4 px-4">
        <SkeletonChart label="Loading total wealth" />
      </div>
      <div className="mt-4">
        <SkeletonRows rows={5} />
      </div>
    </div>
  );
}
