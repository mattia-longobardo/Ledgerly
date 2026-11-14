import { cn } from "@/ui/cn";

export function BrandMark({ size = 24 }: { size?: 24 | 28 }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid shrink-0 place-items-center bg-fg font-semibold text-card",
        size === 24 ? "size-6 rounded-ctl text-sm" : "size-7 rounded-[7px] text-md",
      )}
    >
      L
    </span>
  );
}

/** The mark with the product's name beside it: the head of a card seen before sign-in. */
export function BrandLockup({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark size={28} />
      <span className="text-lg font-semibold">{name}</span>
    </div>
  );
}
