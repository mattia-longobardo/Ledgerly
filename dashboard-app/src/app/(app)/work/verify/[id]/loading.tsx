import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

export default function VerifyLoading() {
  return (
    <div className="px-4 pt-4">
      <Skeleton className="h-4 w-16" />
      <Skeleton className="mt-3 h-7 w-48" />
      <div className="mt-6">
        <SkeletonText lines={3} />
      </div>
      <div className="mt-6 flex flex-col gap-4">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className="block space-y-2">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-11 w-full rounded-md" />
          </span>
        ))}
      </div>
    </div>
  );
}
