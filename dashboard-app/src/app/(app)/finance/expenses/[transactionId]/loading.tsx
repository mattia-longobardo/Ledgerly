import { Skeleton } from "@/components/ui/Skeleton";

export default function TransactionDetailLoading() {
  return (
    <div className="pt-4">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-2 h-6 w-48" />
      <div className="max-w-md pt-6">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="mt-4 h-11 w-full" />
        <Skeleton className="mt-4 h-11 w-32" />
      </div>
    </div>
  );
}
