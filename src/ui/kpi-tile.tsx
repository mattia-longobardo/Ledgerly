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
}: {
  label: string;
  value: string;
  valueTone?: Tone;
  delta?: string;
  deltaTone?: Tone;
  note?: string;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium text-muted">{label}</span>
      <span className={cn("text-kpi font-semibold tracking-[-0.02em]", TONE_TEXT[valueTone])}>{value}</span>
      {(delta || note) && (
        <div className="flex items-center justify-between gap-2 text-sm whitespace-nowrap">
          {delta && <span className={cn("font-medium", TONE_TEXT[deltaTone])}>{delta}</span>}
          {note && <span className="truncate text-faint">{note}</span>}
        </div>
      )}
    </Card>
  );
}
