import { cn } from "@/components/ui/cn";

export function formatCurrency(value: string | number | null | undefined, currency: string): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "—";
  try {
    return new Intl.NumberFormat("it-IT", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch {
    return `${numeric.toFixed(2)} ${currency}`;
  }
}

export function formatSignedCurrency(value: string | number | null | undefined, currency: string): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "—";
  const sign = numeric > 0 ? "+" : numeric < 0 ? "−" : "";
  return `${sign}${formatCurrency(Math.abs(numeric), currency)}`;
}

export function CurrencyValue({
  value,
  currency,
  size = "body",
  className,
}: {
  value: string | number | null | undefined;
  currency: string;
  size?: "body" | "display-sm" | "display";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "num tracking-tight",
        size === "body" ? "text-body" : size === "display-sm" ? "text-display-sm" : "text-display",
        className,
      )}
    >
      {formatCurrency(value, currency)}
    </span>
  );
}
