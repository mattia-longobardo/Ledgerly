"use client";

import { LAST_DAY } from "@ledgerly/api-contract/settings";
import { useTranslations } from "use-intl";
import { Chip } from "../button";
import { weekdayNames } from "./describe";

const toggled = (list: number[], value: number) =>
  list.includes(value)
    ? list.filter((one) => one !== value)
    : [...list, value].sort((left, right) => left - right);

export function WeekdayChips({
  label,
  locale,
  weekdays,
  onChange,
}: {
  label: string;
  locale: string;
  weekdays: number[];
  onChange: (weekdays: number[]) => void;
}) {
  const short = weekdayNames(locale);
  const long = weekdayNames(locale, "long");
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {short.map((name, index) => (
        <Chip
          key={name}
          active={weekdays.includes(index + 1)}
          aria-label={long[index]}
          onClick={() => onChange(toggled(weekdays, index + 1))}
          className="min-w-10 justify-center"
        >
          {name}
        </Chip>
      ))}
    </div>
  );
}

const MONTH_DAYS = Array.from({ length: 31 }, (_day, index) => index + 1);

export function MonthDayChips({
  label,
  monthDays,
  onChange,
}: {
  label: string;
  monthDays: number[];
  onChange: (monthDays: number[]) => void;
}) {
  const text = useTranslations("settings.integrations.scheduleControl");
  return (
    <div role="group" aria-label={label} className="grid grid-cols-7 gap-1">
      {MONTH_DAYS.map((day) => (
        <Chip
          key={day}
          active={monthDays.includes(day)}
          onClick={() => onChange(toggled(monthDays, day))}
          className="justify-center px-0 tabular-nums"
        >
          {day}
        </Chip>
      ))}
      <Chip
        active={monthDays.includes(LAST_DAY)}
        onClick={() => onChange(toggled(monthDays, LAST_DAY))}
        className="col-span-3 justify-center"
      >
        {text("days.lastLong")}
      </Chip>
    </div>
  );
}
