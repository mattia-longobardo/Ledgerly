import { Card } from "@ledgerly/ui/card";
import { Skeleton } from "@ledgerly/ui/skeleton";

/** The shape of the procedure while it reads (§3.6): the steps and a card with four rows. */
export function WizardSkeleton() {
  return (
    <div data-testid="fund-wizard-loading" className="flex w-full flex-col gap-4">
      <Skeleton className="h-6 w-72 max-w-full" />
      <Card className="flex flex-col gap-4">
        <Skeleton className="h-6 w-32" />
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-8 w-full" />
        ))}
      </Card>
    </div>
  );
}
