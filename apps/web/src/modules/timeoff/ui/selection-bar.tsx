import { Button } from "@ledgerly/ui/button";

/**
 * The bar that is there while a range has a first day and no last one (rewrite plan N5).
 *
 * It is the visible control for the two steps that would otherwise be hidden: "this day only" and
 * "cancel". It sticks to the bottom of the calendar's card — above the tab bar on a phone, where
 * the toasts sit too; the two never meet, since a toast only comes after the panel has closed.
 */
export function SelectionBar({
  text,
  singleLabel,
  cancelLabel,
  onSingle,
  onCancel,
}: {
  text: string;
  singleLabel: string;
  cancelLabel: string;
  onSingle: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="status"
      data-testid="selection-bar"
      className="sticky bottom-4 z-10 flex animate-in flex-wrap items-center justify-end gap-x-3 gap-y-2 rounded-lg border border-border bg-card px-3 py-2 text-base shadow-overlay max-md:bottom-[84px]"
    >
      <span className="min-w-0 flex-1 basis-56">{text}</span>
      <div className="flex gap-2">
        <Button onClick={onSingle} className="max-md:h-9">
          {singleLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel} className="max-md:h-9">
          {cancelLabel}
        </Button>
      </div>
    </div>
  );
}
