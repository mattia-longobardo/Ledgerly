import { cn } from "./cn";

const SIZE = {
  22: "size-[22px] text-[10px]",
  24: "size-6 text-xs",
  28: "size-7 text-xs",
  40: "size-10 text-md",
} as const;

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function Avatar({ name, size = 24 }: { name: string; size?: keyof typeof SIZE }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full bg-soft font-semibold text-accent",
        SIZE[size],
      )}
    >
      {initials(name)}
    </span>
  );
}
