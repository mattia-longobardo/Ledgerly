import { cn } from "@/ui/cn";
import type { CalendarCell } from "@ledgerly/domain/timeoff/client";
import { KIND_BORDER, KIND_CLASS, KIND_TEXT } from "./kinds";

/** Where a day stands in the range being picked: one of its two ends, inside it, or outside. */
export type CellSelection = "edge" | "inside" | null;

/** Forty pixels on a phone, where a finger has to find it; twenty-eight where a mouse drags over it. */
const SIZE = "h-7 min-w-0 rounded-[4px] text-xs max-md:h-10 max-md:rounded-ctl max-md:text-base";

/** The padding at either end of a month: as tall as a day, so the weeks keep their rows. */
export function BlankCell() {
  return <span className="h-7 max-md:h-10" />;
}

/**
 * One day of the year calendar, in every state it can be drawn in (rewrite plan N5, UI-TOF-6).
 *
 * A day something can happen to is a real `<button>`: a free working day, and any day that carries
 * leave. A weekend or a public holiday with nothing on it is a `<span>` — it cannot be the first or
 * the last day of a range, only lie inside one, where it is drawn struck through.
 *
 * The cell draws and nothing else: the calendar listens for the clicks, the pointer and the keys on
 * the grid, and reads the day off `data-date`.
 */
export function DayCell({
  cell,
  label,
  tabbable,
  today,
  selection,
  waiting,
}: {
  cell: CalendarCell & { date: string };
  label: string;
  /** Whether this is the day its month offers to the Tab key. */
  tabbable: boolean;
  today: boolean;
  selection: CellSelection;
  /** Drawn as it will be, and paler: the server has not answered yet. */
  waiting: boolean;
}) {
  const marked = cell.kinds.length > 0;
  const planned = cell.status === "planned";
  const number = (
    <span className={cn("relative", today && "font-semibold underline underline-offset-2")}>
      {Number(cell.date.slice(8, 10))}
    </span>
  );

  if (!marked && (cell.weekend || cell.holiday)) {
    return (
      <span
        data-date={cell.date}
        data-selected={selection === null ? undefined : "excluded"}
        className={cn(
          "grid place-items-center border border-transparent tabular-nums",
          SIZE,
          selection !== null
            ? "bg-sel text-muted line-through"
            : cell.holiday
              ? "border-border bg-hover text-muted"
              : "text-faint",
        )}
      >
        {number}
      </span>
    );
  }

  return (
    <button
      type="button"
      data-testid={marked ? "leave-cell" : "free-cell"}
      data-date={cell.date}
      data-partial={cell.partial ? "true" : undefined}
      // Drawn hollow or filled (N8); stated as well as drawn, so a test can see it.
      data-status={marked ? (cell.status ?? undefined) : undefined}
      data-selected={selection ?? undefined}
      data-today={today ? "true" : undefined}
      tabIndex={tabbable ? 0 : -1}
      title={label}
      aria-label={label}
      className={cn(
        "focus-ring relative grid scroll-mb-24 place-items-center overflow-hidden tabular-nums",
        SIZE,
        waiting && "opacity-60",
        marked
          ? cn(
              "font-medium",
              // Counted is filled, planned is hollow — a real difference, not a one-pixel accent
              // border, which in this theme is the same teal as a vacation day.
              planned ? cn("border-2", KIND_BORDER[cell.kinds[0]]) : "border border-transparent",
              // A booked day inside the range keeps its own drawing: the ring says it is in.
              selection !== null && "ring-2 ring-accent ring-offset-1 ring-offset-card",
            )
          : cn(
              "border border-transparent",
              selection === "edge"
                ? "bg-primary font-semibold text-primary-fg"
                : selection === "inside"
                  ? "bg-sel text-fg"
                  : "text-fg hover:bg-hover",
            ),
      )}
    >
      {marked && !planned && (
        <>
          <span aria-hidden="true" className={cn("absolute inset-0", KIND_CLASS[cell.kinds[0]])} />
          {/* A second kind on the same day takes the opposite corner. */}
          {cell.kinds.length > 1 && (
            <span
              aria-hidden="true"
              className={cn("absolute inset-0", KIND_CLASS[cell.kinds[1]])}
              style={{ clipPath: "polygon(100% 0, 0 0, 100% 100%)" }}
            />
          )}
          {/*
            Less than a whole day: a wedge cut out of the top-right corner. A corner and not a
            diagonal half, because a diagonal runs straight under the number and leaves half the
            digit on the colour and half off it — which is exactly the contrast axe refuses.
          */}
          {cell.partial && (
            <span
              aria-hidden="true"
              className="absolute inset-0 bg-card"
              style={{ clipPath: "polygon(55% 0, 100% 0, 100% 45%)" }}
            />
          )}
        </>
      )}
      {marked && planned && (
        <>
          {/* A planned half day: the outline is there either way, so the corner that says "half"
              is drawn in the kind's colour instead of cut out. */}
          {cell.partial && (
            <span
              aria-hidden="true"
              className={cn("absolute inset-0", KIND_CLASS[cell.kinds[0]])}
              style={{ clipPath: "polygon(0 55%, 0 100%, 45% 100%)" }}
            />
          )}
          {/*
            A second kind on a planned day (N10). A hollow cell has no fill for the opposite corner
            to cut into, so the other kind gets a corner of its own — otherwise half vacation and
            half ROL is drawn exactly like a day of vacation.
          */}
          {cell.kinds.length > 1 && (
            <span
              aria-hidden="true"
              className={cn("absolute inset-0", KIND_CLASS[cell.kinds[1]])}
              style={{ clipPath: "polygon(55% 0, 100% 0, 100% 45%)" }}
            />
          )}
        </>
      )}
      <span className={cn("relative", marked && (planned ? KIND_TEXT[cell.kinds[0]] : "text-primary-fg"))}>
        {number}
      </span>
    </button>
  );
}
