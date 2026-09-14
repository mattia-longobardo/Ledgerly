import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export function Card({
  padded = true,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
  return (
    <div className={cn("rounded-card border border-border bg-card", padded && "p-4", className)} {...props} />
  );
}

export function CardHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {actions && <div className="flex items-center gap-2 text-sm">{actions}</div>}
    </div>
  );
}
