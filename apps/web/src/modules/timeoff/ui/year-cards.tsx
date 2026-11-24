// The figures of the year: what is left of each type with an allowance, what the year came to
// altogether, and the twelve months as bars.
import { Card } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { KindCard, MonthBars, YearCard } from "./kind-card";
import { COLOR_FILL, colorOf, nameOf } from "./kinds";
import { bareDays, cardOf, daysOf, type MonthBar, monthNamesOf, type Say, type View } from "./words";

export function YearCards({ view, year, say }: { view: View; year: number; say: Say }) {
  const { text } = say;
  return (
    <div className="grid gap-4 @4xl:grid-cols-2 @6xl:grid-cols-4">
      {view.balances.map((balance) => {
        const planned = balance.residual.plannedMinutes;
        return (
          <KindCard
            key={balance.typeId}
            label={nameOf(view.types, balance.typeId)}
            {...cardOf(say, balance)}
            plannedNote={planned > 0 ? text("cards.planned", { amount: daysOf(say, planned) }) : null}
            fill={COLOR_FILL[colorOf(view.types, balance.typeId)]}
            testId="balance-card"
          />
        );
      })}
      <TakenCard view={view} year={year} say={say} />
      <BarsCard view={view} year={year} say={say} />
    </div>
  );
}

/** What the year came to altogether (N5): every type, and the two halves of it. */
function TakenCard({ view, year, say }: { view: View; year: number; say: Say }) {
  const { text } = say;
  const stated = view.balances.flatMap((one) =>
    one.allowanceMinutes === null ? [] : [one.allowanceMinutes],
  );
  return (
    <YearCard
      label={text("cards.takenTitle", { year })}
      aside={
        stated.length === 0
          ? text("cards.noTotal")
          : text("cards.ofTotal", {
              total: daysOf(
                say,
                stated.reduce((sum, one) => sum + one, 0),
              ),
            })
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
        {view.totals.byType.map((share) => (
          <li key={share.typeId} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn("size-2 rounded-xs", COLOR_FILL[colorOf(view.types, share.typeId)])}
            />
            {nameOf(view.types, share.typeId)} {daysOf(say, share.minutes)}
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
      {/* The bars come in the order of the leave year, which may start in any month. */}
      <MonthBars
        bars={view.bars}
        shortNames={view.bars.map((bar) => names.short[bar.month - 1])}
        labelFor={labelFor}
      />
    </Card>
  );
}
