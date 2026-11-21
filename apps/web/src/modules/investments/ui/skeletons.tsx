// The shapes of the Investments screens while their code and their data are read.
import { Card } from "@ledgerly/ui/card";
import { Skeleton } from "@ledgerly/ui/skeleton";

const FRAME = "@container mx-auto flex w-full max-w-[1920px] flex-col gap-4 p-6 max-md:p-4";

/** The home: the period, the hero, the parts, the chart. */
export function HomeSkeleton() {
  return (
    <main data-testid="investments-loading" className={FRAME}>
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
    </main>
  );
}

/** A service: its header, its tabs, its first card. */
export function ServiceSkeleton() {
  return (
    <main data-testid="investments-loading" className={FRAME}>
      <Skeleton className="h-5 w-56 max-w-full" />
      <Skeleton className="h-8 w-72 max-w-full" />
      <Skeleton className="h-9 w-96 max-w-full" />
      <Card>
        <Skeleton className="h-52 w-full" />
      </Card>
    </main>
  );
}
