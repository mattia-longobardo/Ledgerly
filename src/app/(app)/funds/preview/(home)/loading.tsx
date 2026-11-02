import { Card } from "@/ui/card";
import { Skeleton } from "@/ui/skeleton";

/** The shape of the home while it reads (§6): the hero, the KPIs, the chart and two rows. */
export default function FundsHomeLoading() {
  return (
    <main
      data-testid="funds-home-loading"
      className="@container mx-auto flex w-full max-w-[1920px] flex-col gap-4 p-6 max-md:p-4"
    >
      <Skeleton className="h-7 w-72 max-w-full" />
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
