// The figures of the year: what is left of vacation and of ROL, what the year came to altogether,
// and the twelve months as bars.
import { Card } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { KindCard, MonthBars, YearCard } from "./kind-card";
import { KIND_CLASS } from "./kinds";
import { bareDays, cardOf, daysOf, type MonthBar, monthNamesOf, type Say, type View } from "./words";

export function YearCards({ view, year, say }: { view: View; year: number; say: Say }) {
  const { text } = say;
  const rolPlanned = view.rol.residual.plannedMinutes;
  return (
    <div className="grid gap-4 @4xl:grid-cols-2 @6xl:grid-cols-4">
      <KindCard
        label={text("cards.vacation")}
        {...cardOf(say, view.vacation, view.accrual.vacation)}
        plannedNote={text("cards.planned", { amount: daysOf(say, view.vacation.residual.plannedMinutes) })}
        tone="primary"
        testId="vacation-card"
      />
      <KindCard
        label={text("cards.rol")}
        {...cardOf(say, view.rol, view.accrual.rol)}
        plannedNote={rolPlanned > 0 ? text("cards.planned", { amount: daysOf(say, rolPlanned) }) : null}
        tone="warn"
        testId="rol-card"
      />
      <TakenCard view={view} year={year} say={say} />
      <BarsCard view={view} year={year} say={say} />
    </div>
  );
}

/** What the year came to altogether (N5): every kind, and the two halves of it. */
function TakenCard({ view, year, say }: { view: View; year: number; say: Say }) {
  const { text } = say;
  return (
    <YearCard
      label={text("cards.takenTitle", { year })}
      aside={
        view.totalAllowanceMinutes === null
          ? text("cards.noTotal")
          : text("cards.ofTotal", { total: daysOf(say, view.totalAllowanceMinutes) })
      }
      value={bareDays(say, view.totals.totalMinutes)}
      unit={text("cards.daysTaken")}
      testId="taken-card"
    >
      <p className="text-sm text-muted tabular-nums">
        {text("cards.split", {
          taken: daysOf(say, view.totals.takenMinutes),
          planned: daysOf(say, view.totals.plannedMinutes),
        })}
      </p>
      <ul className="flex flex-wrap gap-x-3 text-xs text-faint tabular-nums">
        {view.totals.byKind.map((share) => (
          <li key={share.kind} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={cn("size-2 rounded-xs", KIND_CLASS[share.kind])} />
            {text(`kinds.${share.kind}`)} {daysOf(say, share.minutes)}
          </li>
        ))}
      </ul>
    </YearCard>
  );
}

function BarsCard({ view, year, say }: { view: View; year: number; say: Say }) {
  const { text, locale } = say;
  const names = monthNamesOf(year, locale);
  const labelFor = (bar: MonthBar): string =>
    text("bars.label", {
      month: names.long[bar.month - 1],
      taken: daysOf(say, bar.takenMinutes),
      planned: daysOf(say, bar.plannedMinutes),
    });
  return (
    <Card className="flex min-w-0 flex-col gap-2">
      <span className="text-sm font-medium text-muted">{text("bars.title")}</span>
      <MonthBars bars={view.bars} shortNames={names.short} labelFor={labelFor} />
    </Card>
  );
}
