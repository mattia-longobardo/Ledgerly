import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { SkeletonChart, SkeletonHero, SkeletonRows } from "@/components/ui/Skeleton";

/**
 * Content-shaped placeholders; spinners are reserved for buttons. The skeleton
 * is laid out on the same grid as the page it stands in for, so the figures do
 * not jump columns when the data lands.
 */
export default function AppLoading() {
  return (
    <PageGrid className="pt-10">
      <Panel span={8}>
        <SkeletonHero />
      </Panel>
      <Panel span={4}>
        <SkeletonHero />
      </Panel>
      <Panel span={8}>
        <SkeletonChart />
      </Panel>
      <Panel span={4}>
        <SkeletonRows rows={5} />
      </Panel>
    </PageGrid>
  );
}
