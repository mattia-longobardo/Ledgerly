import { Card } from "./card";
import { cn } from "./cn";
import { type Tone, TONE_TEXT } from "./tone";

export function KpiTile({
  label,
  value,
  valueTone = "fg",
  delta,
  deltaTone = "muted",
  note,
  wrapNote = false,
  testId,
  className,
}: {
  label: string;
  value: string;
  valueTone?: Tone;
  delta?: string;
  deltaTone?: Tone;
  note?: string;
  /** A note of a whole sentence (Funds): on its own lines under the value, never cut. */
  wrapNote?: boolean;
  testId?: string;
  className?: string;
}) {
  return (
    <Card className={cn("flex min-w-0 flex-col gap-1.5", className)} data-testid={testId}>
      <span className="text-sm font-medium text-muted">{label}</span>
      <span
        className={cn(
          "text-kpi font-semibold tracking-title",
          wrapNote && "tabular-nums",
          TONE_TEXT[valueTone],
        )}
      >
        {value}
      </span>
      {wrapNote && note && <span className="text-sm text-muted">{note}</span>}
      <KpiFooter delta={delta} deltaTone={deltaTone} note={wrapNote ? undefined : note} />
    </Card>
  );
}

/** The line under the value: the delta and, when it is not wrapped, the note. */
function KpiFooter({ delta, deltaTone, note }: { delta?: string; deltaTone: Tone; note?: string }) {
  if (!delta && !note) return null;
  return (
    <div className="flex items-center justify-between gap-2 text-sm whitespace-nowrap">
      {delta && <span className={cn("font-medium", TONE_TEXT[deltaTone])}>{delta}</span>}
      {note && <span className="truncate text-faint">{note}</span>}
    </div>
  );
}
