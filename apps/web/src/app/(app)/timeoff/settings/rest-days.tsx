"use client";

// The days off of the year (R5g): days the person does not work every year — the patron saint of
// their town, a company's closing day — beside the calendars of public holidays.
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import { intlLocale } from "@ledgerly/format/format";
import { Button } from "@ledgerly/ui/button";
import { Field } from "@ledgerly/ui/field";
import { Input, Select } from "@ledgerly/ui/input";
import { FIELD_GRID } from "@ledgerly/ui/section";
import { notify } from "@ledgerly/ui/toast";
import { addRestDayAction, deleteRestDayAction, settingsChanged } from "./calls";
import { ErrorLine } from "./settings-forms";

interface RestDay {
  id: string;
  month: number;
  day: number;
  name: string;
}

const MONTHS = Array.from({ length: 12 }, (_unused, index) => index + 1);
// A non-leap year, as the server checks a date: February has 28 days here.
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** «7 December»: a day of every year, in the reader's language, as the app writes a date. */
function useDayName() {
  const format = new Intl.DateTimeFormat(intlLocale(useLocale()), { month: "long", timeZone: "UTC" });
  const month = (index: number) => format.format(new Date(Date.UTC(2023, index - 1, 1)));
  return { month, date: (index: number, day: number) => `${day} ${month(index)}` };
}

export function RestDays({ days }: { days: RestDay[] }) {
  const text = useTranslations("timeoff.settings.restDays");
  const names = useDayName();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function remove(day: RestDay) {
    const label = `${names.date(day.month, day.day)} · ${day.name}`;
    if (!window.confirm(text("confirmRemove", { day: label }))) return;
    start(async () => {
      const result = await deleteRestDayAction(day.id);
      if (!result.ok) return setError(text("failed"));
      setError(null);
      notify(text("removed", { day: label }));
      settingsChanged();
    });
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <h3 className="text-sm font-medium">{text("title")}</h3>
      {days.length === 0 ? (
        <p className="text-sm text-muted">{text("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="rest-days">
          {days.map((day) => (
            <li key={day.id} className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="min-w-0 flex-1 truncate">
                {names.date(day.month, day.day)} · {day.name}
              </span>
              <Button
                size="xs"
                variant="danger"
                disabled={pending}
                onClick={() => remove(day)}
                aria-label={text("removeOf", { day: day.name })}
              >
                {text("remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ErrorLine error={error} />
      <AddRestDay />
    </div>
  );
}

/** A month, a day of it and a name, added at once with their own button: not a form of the banner. */
function AddRestDay() {
  const text = useTranslations("timeoff.settings.restDays");
  const names = useDayName();
  const id = useId();
  const [date, setDate] = useState({ month: 1, day: 1 });
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === "") return setError(text("nameMissing"));
    start(async () => {
      const result = await addRestDayAction({ ...date, name });
      if (!result.ok) return setError(result.error === "conflict" ? text("duplicate") : text("failed"));
      setError(null);
      setName("");
      notify(text("added", { day: `${names.date(date.month, date.day)} · ${name.trim()}` }));
      settingsChanged();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" data-testid="add-rest-day">
      <div className={FIELD_GRID}>
        <DateFields value={date} onChange={setDate} />
        <Field label={text("name")} htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
      </div>
      <ErrorLine error={error} />
      <div>
        <Button type="submit" disabled={pending}>
          {text("add")}
        </Button>
      </div>
    </form>
  );
}

/** A month and a day of it: a day past the month's end moves back to its last day. */
function DateFields({
  value,
  onChange,
}: {
  value: { month: number; day: number };
  onChange: (value: { month: number; day: number }) => void;
}) {
  const text = useTranslations("timeoff.settings.restDays");
  const names = useDayName();
  const id = useId();
  const last = DAYS_IN_MONTH[value.month - 1];
  return (
    <>
      <Field label={text("month")} htmlFor={`${id}-month`}>
        <Select
          id={`${id}-month`}
          value={value.month}
          onChange={(event) => {
            const month = Number(event.target.value);
            onChange({ month, day: Math.min(value.day, DAYS_IN_MONTH[month - 1]) });
          }}
        >
          {MONTHS.map((one) => (
            <option key={one} value={one}>
              {names.month(one)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={text("day")} htmlFor={`${id}-day`}>
        <Select
          id={`${id}-day`}
          value={value.day}
          onChange={(event) => onChange({ month: value.month, day: Number(event.target.value) })}
        >
          {Array.from({ length: last }, (_unused, index) => index + 1).map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}
