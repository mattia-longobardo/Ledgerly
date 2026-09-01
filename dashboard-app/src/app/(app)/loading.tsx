import { SkeletonHero, SkeletonRows, SkeletonTile } from "@/components/ui/Skeleton";

/** Content-shaped placeholders; spinners are reserved for buttons. */
export default function AppLoading() {
  return (
    <div className="px-4 pt-4 pb-8">
      <SkeletonHero />
      <div className="-mx-4 mt-6">
        <SkeletonRows rows={5} />
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <SkeletonTile />
        <SkeletonTile />
      </div>
    </div>
  );
}
