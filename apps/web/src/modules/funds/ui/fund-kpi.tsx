import { Card } from "@/ui/card";
import { cn } from "@/ui/cn";
import { type Tone, TONE_TEXT } from "@/ui/tone";

/** A KPI whose note wraps: the tiles here explain their number, and a cut note explains nothing. */
export function Kpi({
  label,
  value,
  tone = "fg",
  note,
  testId,
}: {
  label: string;
  value: string;
  tone?: Tone;
  note?: string;
  testId?: string;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-1.5" data-testid={testId}>
      <span className="text-sm font-medium text-muted">{label}</span>
      <span className={cn("text-kpi font-semibold tracking-[-0.02em] tabular-nums", TONE_TEXT[tone])}>
        {value}
      </span>
      {note && <span className="text-sm text-muted">{note}</span>}
    </Card>
  );
}
