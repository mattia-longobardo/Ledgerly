"use client";

// The working week and the first month of the leave year (R5g): which days a range books, and which
// twelve months the residuals are about.
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";
import { intlLocale } from "@ledgerly/format/format";
import { Field } from "@ledgerly/ui/field";
import { Checkbox, Select } from "@ledgerly/ui/input";
import { FIELD_GRID } from "@ledgerly/ui/section";
import { saveLeaveSettingsAction } from "./calls";
import { ErrorLine, useSave } from "./settings-forms";

const MONTHS = Array.from({ length: 12 }, (_unused, index) => index + 1);

/** The names of the months and of the days of the week, in the reader's language. */
function namesIn(locale: string) {
  const formatter = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(intlLocale(locale), { ...options, timeZone: "UTC" });
  const month = formatter({ month: "long" });
  const weekday = formatter({ weekday: "long" });
  return {
    month: (index: number) => month.format(new Date(Date.UTC(2023, index - 1, 1))),
    // 2026-02-01 is a Sunday: day 0 of this week really is Sunday.
    weekday: (day: number) => weekday.format(new Date(Date.UTC(2026, 1, 1 + day))),
  };
}

export function WorkWeekForm({
  workDays,
  yearStartMonth,
  weekStart,
}: {
  workDays: number[];
  yearStartMonth: number;
  /** 0 Sunday or 1 Monday: the order the days are listed in. */
  weekStart: number;
}) {
  const text = useTranslations("timeoff.settings.week");
  const locale = useLocale();
  const id = useId();
  const [days, setDays] = useState(() => new Set(workDays));
  const [startMonth, setStartMonth] = useState(yearStartMonth);
  const { error, save, formRef } = useSave(text("saved"));
  const names = namesIn(locale);

  function submit(event: FormEvent) {
    event.preventDefault();
    save(() =>
      saveLeaveSettingsAction({
        workDays: [...days].sort((one, two) => one - two),
        yearStartMonth: startMonth,
      }),
    );
  }

  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-3">
      <WeekDays days={days} onChange={setDays} weekStart={weekStart} weekday={names.weekday} />
      <div className={FIELD_GRID}>
        <Field label={text("startMonth")} htmlFor={`${id}-start`} hint={text("startMonthHint")}>
          <Select
            id={`${id}-start`}
            value={startMonth}
            onChange={(event) => setStartMonth(Number(event.target.value))}
          >
            {MONTHS.map((month) => (
              <option key={month} value={month}>
                {names.month(month)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {days.size === 0 && <p className="text-sm text-warn">{text("noDays")}</p>}
      <ErrorLine error={error} />
    </form>
  );
}

/** The seven days, from the person's first day of the week: a box each. */
function WeekDays({
  days,
  onChange,
  weekStart,
  weekday,
}: {
  days: ReadonlySet<number>;
  onChange: (change: (was: Set<number>) => Set<number>) => void;
  weekStart: number;
  weekday: (day: number) => string;
}) {
  const text = useTranslations("timeoff.settings.week");
  const week = Array.from({ length: 7 }, (_unused, index) => (weekStart + index) % 7);
  function toggle(day: number, checked: boolean) {
    onChange((was) => {
      const next = new Set(was);
      if (checked) next.add(day);
      else next.delete(day);
      return next;
    });
  }
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{text("days")}</legend>
      <div className="flex flex-wrap gap-x-4">
        {week.map((day) => (
          <Checkbox
            key={day}
            label={weekday(day)}
            checked={days.has(day)}
            onChange={(event) => toggle(day, event.target.checked)}
          />
        ))}
      </div>
    </fieldset>
  );
}
