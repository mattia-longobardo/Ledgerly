import { Skeleton, SkeletonTile } from "@/components/ui/Skeleton";

export default function FundsLoading() {
  return (
    <div className="px-4 pt-4">
      <Skeleton className="h-6 w-24" />
      <Skeleton className="mt-3 h-11 w-full" />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <SkeletonTile />
        <SkeletonTile />
      </div>
    </div>
  );
}
