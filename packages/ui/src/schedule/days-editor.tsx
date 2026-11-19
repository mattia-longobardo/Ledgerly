"use client";

import { useId } from "react";
import { useTranslations } from "use-intl";
import { Field } from "../field";
import { Select } from "../input";
import { MonthDayChips, WeekdayChips } from "./day-chips";
import type { DaysDraft, DaysKind } from "./drafts";

const DAYS_KINDS: readonly DaysKind[] = ["every", "weekdays", "monthDays"];
const isDaysKind = (value: string): value is DaysKind => DAYS_KINDS.some((kind) => kind === value);

/** The days of one rule under "Custom rules". */
export function DaysEditor({
  number,
  days,
  locale,
  onChange,
}: {
  number: number;
  days: DaysDraft;
  locale: string;
  onChange: (days: DaysDraft) => void;
}) {
  const text = useTranslations("settings.integrations.scheduleControl");
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <Field label={text("days.label")} htmlFor={`${id}-days`}>
        <Select
          id={`${id}-days`}
          value={days.kind}
          onChange={(event) =>
            isDaysKind(event.target.value) && onChange({ ...days, kind: event.target.value })
          }
          className="w-auto self-start"
        >
          {DAYS_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {text(`days.${kind}`)}
            </option>
          ))}
        </Select>
      </Field>
      {days.kind === "weekdays" && (
        <WeekdayChips
          label={text("days.weekdaysOf", { n: number })}
          locale={locale}
          weekdays={days.weekdays}
          onChange={(weekdays) => onChange({ ...days, weekdays })}
        />
      )}
      {days.kind === "monthDays" && (
        <MonthDayChips
          label={text("days.monthDaysOf", { n: number })}
          monthDays={days.monthDays}
          onChange={(monthDays) => onChange({ ...days, monthDays })}
        />
      )}
    </div>
  );
}
