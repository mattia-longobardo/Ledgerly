import type { Route } from "next";
import Link from "next/link";
import { cn } from "@/ui/cn";

export type RangeKey = "3m" | "1y" | "all";

const MONTHS: Record<RangeKey, number> = { "3m": 3, "1y": 12, all: 120 };

export function rangeMonths(range: RangeKey | undefined): number {
  return MONTHS[range ?? "1y"] ?? MONTHS["1y"];
}

/**
 * The design's 3M · 1Y · All switch, as links rather than state: the range lives in the URL, so
 * the server renders the chosen window and the control works before any JavaScript has run
 * (spec §8.4, every static control of the prototype works).
 */
export function RangeTabs({
  current,
  label,
  basePath = "/",
}: {
  current: RangeKey;
  label: string;
  basePath?: string;
}) {
  const keys: RangeKey[] = ["3m", "1y", "all"];
  return (
    <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-[7px] bg-hover p-0.5">
      {keys.map((key) => (
        <Link
          key={key}
          href={`${basePath}?range=${key}` as Route}
          aria-current={key === current ? "true" : undefined}
          className={cn(
            "focus-ring inline-flex h-6 items-center rounded-[5px] px-2.5 text-sm font-medium",
            key === current
              ? "bg-card text-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
              : "text-muted hover:text-fg",
          )}
        >
          {key === "all" ? "All" : key.toUpperCase()}
        </Link>
      ))}
    </div>
  );
}
