import { formatEur, splitEur, type Money } from "@/lib/format";
import { cn } from "./cn";

export type MoneySize = "body" | "display-sm" | "display" | "display-lg";
export type CentsMode = "full" | "muted" | "hide";

const SIZE_CLASS: Record<MoneySize, string> = {
  body: "text-body",
  "display-sm": "text-display-sm",
  display: "text-display",
  "display-lg": "text-display sm:text-display-lg",
};

export interface MoneyValueProps {
  value: Money;
  size?: MoneySize;
  cents?: CentsMode;
  className?: string;
}

export function MoneyValue({ value, size = "body", cents, className }: MoneyValueProps) {
  const centsMode: CentsMode = cents ?? (size === "body" ? "full" : "muted");

  if (centsMode === "hide") {
    return (
      <span className={cn("num tracking-tight", SIZE_CLASS[size], className)}>
        {formatEur(value, { cents: false })}
      </span>
    );
  }

  const parts = splitEur(value);

  return (
    <span className={cn("num tracking-tight", SIZE_CLASS[size], className)}>
      {parts.main}
      {parts.cents !== "" && (
        <span className={centsMode === "muted" ? "text-fg-muted opacity-70" : undefined}>
          {parts.cents}
        </span>
      )}
      {parts.suffix}
    </span>
  );
}
