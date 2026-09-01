import { cn } from "./cn";

export interface ErrorInlineProps {
  message: string;
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorInline({
  message,
  detail,
  onRetry,
  retryLabel = "Retry",
  className,
}: ErrorInlineProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-negative/5 px-4 py-3",
        className,
      )}
    >
      <span aria-hidden className="text-body font-semibold text-negative">
        !
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-sm text-fg">{message}</span>
        {detail !== undefined && (
          <span className="block text-caption text-fg-muted">{detail}</span>
        )}
      </span>
      {onRetry !== undefined && (
        <button
          type="button"
          onClick={onRetry}
          className="-mx-2 inline-flex min-h-11 items-center rounded-xs px-2 text-body-sm font-medium text-accent underline underline-offset-2"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}
