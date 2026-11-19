import { Card } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { type Tone, TONE_TEXT } from "@ledgerly/ui/tone";

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
      <span className={cn("text-kpi font-semibold tracking-title tabular-nums", TONE_TEXT[tone])}>
        {value}
      </span>
      {note && <span className="text-sm text-muted">{note}</span>}
    </Card>
  );
}
