import { cn } from "@/components/ui/cn";

function exactCents(value: string): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  return BigInt(`${match[1]}${match[2]}${(match[3] ?? "").padEnd(2, "0")}`);
}

function decimal(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

export function formatCurrency(value: string | number | null | undefined, currency: string): string {
  if (value === null || value === undefined || value === "") return "—";
  const cents = typeof value === "string" ? exactCents(value) : null;
  if (typeof value === "string" ? cents === null : !Number.isFinite(value)) return "—";
  try {
    const formatter = new Intl.NumberFormat("it-IT", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    // Numeric inputs are chart coordinates. Ledger text always takes the
    // decimal-string path: Intl groups an exact bigint and we supply its cents.
    if (typeof value === "number") return formatter.format(value);
    const amount = cents!;
    const whole = amount / 100n;
    const fraction = ((amount < 0n ? -amount : amount) % 100n).toString().padStart(2, "0");
    return formatter.formatToParts(whole === 0n && amount < 0n ? -0 : whole)
      .map((part) => part.type === "fraction" ? fraction : part.value).join("");
  } catch {
    return `${typeof value === "number" ? value.toFixed(2) : decimal(cents!)} ${currency}`;
  }
}

export function formatSignedCurrency(value: string | number | null | undefined, currency: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    const sign = value > 0 ? "+" : value < 0 ? "−" : "";
    return `${sign}${formatCurrency(Math.abs(value), currency)}`;
  }
  const cents = exactCents(value);
  if (cents === null) return "—";
  const sign = cents > 0n ? "+" : cents < 0n ? "−" : "";
  return `${sign}${formatCurrency(decimal(cents < 0n ? -cents : cents), currency)}`;
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
