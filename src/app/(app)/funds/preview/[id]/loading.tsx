import { Card } from "@/ui/card";
import { Skeleton } from "@/ui/skeleton";

/** The shape of a fund's page while it reads (§6): the header, the hero, the KPIs, the chart and two rows. */
export default function FundDetailLoading() {
  return (
    <main
      data-testid="fund-detail-loading"
      className="@container mx-auto flex w-full max-w-[1920px] flex-col gap-4 p-6 max-md:p-4"
    >
      <Skeleton className="h-12 w-72 max-w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-16 w-80 max-w-full" />
      <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Card key={index}>
            <Skeleton className="h-16 w-full" />
          </Card>
        ))}
      </div>
      <Card>
        <Skeleton className="h-52 w-full" />
      </Card>
      <Card className="flex flex-col gap-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </Card>
    </main>
  );
}
