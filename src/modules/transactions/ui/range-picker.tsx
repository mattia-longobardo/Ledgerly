"use client";

import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { type Params, withParams } from "@/modules/accounts/ui/controls";
import { addMonths, type CivilDate, type MonthKey, monthKey } from "@/platform/dates";
import { formatDate, type UiLocale } from "@/platform/format";
import { Button, IconButton } from "@/ui/button";
import { cn } from "@/ui/cn";
import { calendarCells } from "./display";
import { type DateRange, daysInRange } from "./filters";

/**
 * The narrow weekday initials of the calendar header. `@/platform/format` has no weekday
 * formatter, and these are names rather than a number or a money format (spec §8.5), so they are
 * built here — one of the reasons this picker is a candidate for `src/ui` (spec §8.3).
 */
function weekdayInitials(locale: UiLocale): string[] {
  const formatter = new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
    weekday: "narrow",
    timeZone: "UTC",
  });
  // 5 January 1970 was a Monday, which is the day the design's grid starts on.
  return Array.from({ length: 7 }, (_, index) => formatter.format(new Date(Date.UTC(1970, 0, 5 + index))));
}

/**
 * The design's two-month date range picker (spec §8.3 calls it `DateRangePicker`, and `src/ui/`
 * has none yet), built here so Expenses can have the screen the design shows.
 *
 * It degrades on purpose. The panel is a `<details>`, so it opens without JavaScript; the two
 * date fields and "Apply" are a plain GET form, so a chosen range reaches the server as a
 * navigation whether React is running or not. Only the calendars themselves need JavaScript, and
 * they are the part the two fields make redundant.
 */
export function RangePicker({
  range,
  text,
  params,
  locale,
  label,
  path = "/expenses",
}: {
  range: DateRange;
  /** The range spelled out: this control is the period label of the stepper it sits in. */
  text: string;
  /** The parameters to carry over: everything except the period, which this control replaces. */
  params: Params;
  locale: UiLocale;
  /** The control's own name, as its tooltip: the visible text is the range itself. */
  label: string;
  path?: string;
}) {
  const t = useTranslations("expenses.filters.range");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ from: CivilDate; to: CivilDate | null }>({
    from: range.from,
    to: range.to,
  });
  const [cursor, setCursor] = useState<MonthKey>(monthKey(range.to));

  const from = draft.from;
  const to = draft.to ?? range.to;
  /** While only one end is picked, the highlight stops there rather than reaching the old one. */
  const end = draft.to ?? draft.from;
  const months: MonthKey[] = [addMonths(cursor, -1), cursor];

  function reset() {
    setDraft({ from: range.from, to: range.to });
    setCursor(monthKey(range.to));
  }

  function close() {
    reset();
    setOpen(false);
  }

  /** The prototype's own rule: the first click starts a range, the second one closes it. */
  function pick(day: CivilDate) {
    if (draft.to === null) {
      const [start, finish] = day < draft.from ? [day, draft.from] : [draft.from, day];
      setDraft({ from: start, to: finish });
      return;
    }
    setDraft({ from: day, to: null });
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const picked = { from: String(data.get("from") ?? ""), to: String(data.get("to") ?? "") };
    if (picked.from === "" || picked.to === "") return;
    const ordered = picked.from <= picked.to ? picked : { from: picked.to, to: picked.from };
    setOpen(false);
    router.push(withParams(path, params, { ...ordered, preset: undefined, off: undefined }));
  }

  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="relative">
      <summary
        title={label}
        className="focus-ring flex h-[30px] cursor-pointer list-none items-center justify-center gap-2 rounded-ctl px-2 text-sm font-medium whitespace-nowrap hover:bg-hover [&::-webkit-details-marker]:hidden"
      >
        <Calendar aria-hidden className="size-3.5 text-muted" />
        {text}
      </summary>
      <div className="absolute top-9 left-1/2 z-30 w-[540px] -translate-x-1/2 max-w-[calc(100vw-32px)] animate-in rounded-lg border border-border bg-card p-3.5 shadow-overlay max-md:fixed max-md:inset-x-4 max-md:top-auto max-md:w-auto">
        <form method="get" action={path} onSubmit={apply} className="flex flex-col gap-3">
          {Object.entries(params).map(([name, value]) =>
            value === undefined || value === "" ? null : (
              <input key={name} type="hidden" name={name} value={value} />
            ),
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-muted">{t("from")}</span>
              <input
                type="date"
                name="from"
                required
                value={from}
                onChange={(event) => setDraft({ from: event.currentTarget.value, to: draft.to })}
                className="focus:border-accent focus:outline-1 focus:outline-accent h-[30px] rounded-ctl border border-border bg-card px-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-muted">{t("to")}</span>
              <input
                type="date"
                name="to"
                required
                value={to}
                onChange={(event) => setDraft({ from: draft.from, to: event.currentTarget.value })}
                className="focus:border-accent focus:outline-1 focus:outline-accent h-[30px] rounded-ctl border border-border bg-card px-2 text-sm"
              />
            </label>
          </div>

          <div className="flex items-center justify-between">
            <IconButton label={t("previousMonth")} size={28} onClick={() => setCursor(addMonths(cursor, -1))}>
              <ChevronLeft aria-hidden className="size-3.5" />
            </IconButton>
            <IconButton label={t("nextMonth")} size={28} onClick={() => setCursor(addMonths(cursor, 1))}>
              <ChevronRight aria-hidden className="size-3.5" />
            </IconButton>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {months.map((month) => (
              <div key={month} className="flex flex-col gap-1.5">
                <div className="text-center text-sm font-semibold">
                  {formatDate(month, "monthYear", locale)}
                </div>
                <div className="grid grid-cols-7 gap-0.5 text-center text-micro text-faint">
                  {weekdayInitials(locale).map((initial, index) => (
                    <span key={`${month}-${index}`}>{initial}</span>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-0.5">
                  {calendarCells(month).map((day, index) =>
                    day === null ? (
                      <span key={`${month}-blank-${index}`} />
                    ) : (
                      <button
                        key={day}
                        type="button"
                        onClick={() => pick(day)}
                        aria-pressed={day >= from && day <= end}
                        className={cn(
                          "focus-ring h-[26px] rounded-[4px] text-sm",
                          day === draft.from || day === draft.to
                            ? "bg-primary font-semibold text-primary-fg"
                            : day >= from && day <= end
                              ? "bg-sel"
                              : "hover:bg-hover",
                        )}
                      >
                        {Number(day.slice(8))}
                      </button>
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
            <span>
              {draft.to === null
                ? t("pickEnd")
                : t("hint", {
                    from: formatDate(draft.from, "long", locale),
                    to: formatDate(draft.to, "long", locale),
                    count: daysInRange({ from: draft.from, to: draft.to }),
                  })}
            </span>
            <span className="flex gap-2">
              <Button type="reset" size="sm" onClick={close}>
                {t("cancel")}
              </Button>
              <Button type="submit" size="sm" variant="primary">
                {t("apply")}
              </Button>
            </span>
          </div>
        </form>
      </div>
    </details>
  );
}
