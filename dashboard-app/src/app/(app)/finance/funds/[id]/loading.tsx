import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { Skeleton, SkeletonTile } from "@/components/ui/Skeleton";

export default function FundDetailLoading() {
  return <div className="pt-4"><Skeleton className="h-6 w-24" /><Skeleton className="mt-3 h-11 w-full max-w-md" /><PageGrid className="pt-5"><Panel span={12}><div className="grid gap-3 md:grid-cols-3"><SkeletonTile /><SkeletonTile /><SkeletonTile /></div></Panel><Panel span={7}><Skeleton className="h-80 w-full" /></Panel><Panel span={5}><Skeleton className="h-80 w-full" /></Panel></PageGrid></div>;
}
