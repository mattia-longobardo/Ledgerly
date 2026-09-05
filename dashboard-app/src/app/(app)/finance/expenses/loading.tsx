import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";

export default function ExpensesLoading() {
  return (
    <div className="pt-4">
      <Skeleton className="h-6 w-28" />
      <div className="pt-5">
        <SkeletonRows rows={8} />
      </div>
    </div>
  );
}
