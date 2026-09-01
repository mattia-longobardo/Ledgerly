import type { ReactNode } from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  /** Exactly one action, by design. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-surface px-6 py-10 text-center",
        className,
      )}
    >
      {icon !== undefined && <span className="text-fg-muted">{icon}</span>}
      <h3 className="text-heading-sm text-fg">{title}</h3>
      {description !== undefined && (
        <p className="max-w-xs text-body-sm text-fg-muted">{description}</p>
      )}
      {action !== undefined && <div className="mt-1">{action}</div>}
    </div>
  );
}
