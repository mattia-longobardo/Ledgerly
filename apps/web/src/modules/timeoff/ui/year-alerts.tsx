// The warnings of the Time off page, above the cards on purpose: they are the things on this
// screen that say a number below might be wrong.
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { formatDate } from "@ledgerly/format/format";
import { Card } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { Link } from "@ledgerly/ui/router";
import { nameOf } from "./kinds";
import { daysOf, overdrawnLine, type Say, type View } from "./words";

export function YearAlerts({ view, say }: { view: View; say: Say }) {
  const { text, locale } = say;
  return (
    <>
      {/* Without a calendar of holidays a public holiday reads as a working day (R5g). */}
      {!view.hasHolidayCalendar && (
        <Alert tone="warn" title={text("noCalendar.title")} testId="no-holiday-calendar">
          <p className="text-sm">
            {text("noCalendar.hint")}{" "}
            <Link
              href={`/timeoff/settings?year=${view.year}`}
              className="focus-ring rounded-xs font-medium text-accent underline underline-offset-2"
            >
              {text("noCalendar.action")}
            </Link>
          </p>
        </Alert>
      )}
      {/* Leave the payslips know about and this calendar does not (M2). */}
      {view.unrecordedByType.length > 0 && (
        <Alert
          tone="warn"
          title={text("unrecorded.title", { count: view.unrecordedByType.length })}
          testId="unrecorded"
        >
          <ul className="flex flex-col gap-1 text-sm tabular-nums">
            {view.unrecordedByType.map((gap) => (
              <li key={`${gap.month}-${gap.typeId}`}>
                {text("unrecorded.row", {
                  month: formatDate(gap.month, "monthYear", locale),
                  kind: nameOf(view.types, gap.typeId),
                  payroll: daysOf(say, gap.payrollMinutes),
                  recorded: daysOf(say, gap.recordedMinutes),
                  missing: daysOf(say, gap.missingMinutes),
                })}
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">{text("unrecorded.hint")}</p>
        </Alert>
      )}
      {/* Booked past what was left (N5b), measured against whichever figure the card used. */}
      {view.overdrawnByType.length > 0 && (
        <Alert
          tone="neg"
          title={text("overdrawn.title", { count: view.overdrawnByType.length })}
          testId="overdrawn"
        >
          <ul className="flex flex-col gap-1 text-sm tabular-nums">
            {view.overdrawnByType.map((over) => (
              <li key={over.typeId}>{overdrawnLine(say, over, view.types)}</li>
            ))}
          </ul>
        </Alert>
      )}
    </>
  );
}

function Alert({
  tone,
  title,
  testId,
  children,
}: {
  tone: "warn" | "neg";
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Card
      className={cn(
        "flex flex-col gap-2",
        tone === "warn" ? "border-warn/40 bg-warn-bg" : "border-neg/40 bg-neg-bg",
      )}
      data-testid={testId}
    >
      <div className="flex items-center gap-2">
        <TriangleAlert
          aria-hidden
          className={cn("size-[18px] shrink-0", tone === "warn" ? "text-warn" : "text-neg")}
        />
        <h2 className="font-semibold">{title}</h2>
      </div>
      {children}
    </Card>
  );
}
