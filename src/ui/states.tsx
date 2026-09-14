import { CircleAlert, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./button";
import { Card } from "./card";
import { Skeleton } from "./skeleton";

export function EmptyState({
  title,
  description,
  actions,
  icon = <Inbox aria-hidden className="size-[18px]" />,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-modal border border-dashed border-border2 bg-card px-6 py-14 text-center">
      <div className="grid size-10 place-items-center rounded-card bg-soft text-accent">{icon}</div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-[380px] text-muted">{description}</p>
      {actions && <div className="mt-1 flex gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel,
}: {
  title: string;
  description: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-modal border border-dashed border-neg bg-card px-6 py-14 text-center"
    >
      <div className="grid size-10 place-items-center rounded-card bg-neg-bg text-neg">
        <CircleAlert aria-hidden className="size-[18px]" />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-[380px] text-muted">{description}</p>
      {onRetry && retryLabel && (
        <Button size="md" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

/** The generic page skeleton from the design (title, four KPI tiles, a table). */
export function LoadingState() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-3 w-[120px]" />
      <Skeleton className="h-8 w-[260px] rounded-ctl" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="flex h-[92px] flex-col gap-3">
            <Skeleton className="h-2.5 w-2/5" />
            <Skeleton className="h-[22px] w-[65%]" />
          </Card>
        ))}
      </div>
      <Card className="flex flex-col gap-3">
        <Skeleton className="h-3 w-40" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-4">
            <Skeleton className="h-2.5" />
            <Skeleton className="h-2.5" />
            <Skeleton className="h-2.5" />
            <Skeleton className="h-2.5" />
          </div>
        ))}
      </Card>
    </div>
  );
}
