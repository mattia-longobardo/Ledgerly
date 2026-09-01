import { Skeleton, SkeletonRows, SkeletonTile } from "@/components/ui/Skeleton";

export default function WorkLoading() {
  return (
    <div className="pt-4">
      <div className="px-4">
        <Skeleton className="h-6 w-20" />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <SkeletonTile />
          <SkeletonTile />
          <SkeletonTile />
          <SkeletonTile />
        </div>
      </div>
      <div className="mt-8">
        <SkeletonRows rows={6} />
      </div>
    </div>
  );
}
