"use client";

import { useId } from "react";
import { useTranslations } from "use-intl";
import { Checkbox, Select } from "../input";
import { describeEvery } from "./describe";
import type { RuleError, Simple } from "./drafts";
import { passesInDay, REPEAT_MINUTES, WHOLE_DAY } from "./form";
import { TimeInput } from "./time-input";

/** "Only between": the part of the day a repeating rule is limited to. */
function WindowFields({
  state,
  invalid,
  onChange,
}: {
  state: Simple;
  invalid: boolean;
  onChange: (patch: Partial<Simple>) => void;
}) {
  const text = useTranslations("settings.integrations.scheduleControl");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Checkbox
        label={text("onlyBetween")}
        checked={state.windowed}
        onChange={(event) => onChange({ windowed: event.target.checked })}
      />
      {state.windowed && (
        <span className="flex items-center gap-1.5">
          <TimeInput
            aria-label={text("from")}
            value={state.from}
            invalid={invalid}
            onValue={(from) => onChange({ from })}
          />
          <span aria-hidden className="text-sm">
            –
          </span>
          <TimeInput
            aria-label={text("until")}
            value={state.until}
            invalid={invalid}
            onValue={(until) => onChange({ until })}
          />
        </span>
      )}
    </div>
  );
}

/** "Repeat": the interval, and the part of the day it is limited to. */
export function RepeatFields({
  state,
  error,
  maxPerDay,
  onChange,
}: {
  state: Simple;
  error: RuleError | null | undefined;
  /** The most passes a day the connection allows: an interval over it in the window is disabled. */
  maxPerDay?: number;
  onChange: (patch: Partial<Simple>) => void;
}) {
  const text = useTranslations("settings.integrations.scheduleControl");
  const id = useId();
  const badWindow = error === "window" || error === "time";
  const window = state.windowed ? state : WHOLE_DAY;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-every`} className="text-sm font-medium">
          {text("every")}
        </label>
        <Select
          id={`${id}-every`}
          value={state.every}
          onChange={(event) => onChange({ every: Number(event.target.value) })}
          className="w-auto"
        >
          {REPEAT_MINUTES.map((minutes) => (
            <option
              key={minutes}
              value={minutes}
              disabled={
                maxPerDay !== undefined && passesInDay(minutes, window.from, window.until) > maxPerDay
              }
            >
              {describeEvery(minutes, text)}
            </option>
          ))}
        </Select>
      </div>
      <WindowFields state={state} invalid={badWindow} onChange={onChange} />
      {badWindow && (
        <p role="alert" className="text-sm text-neg">
          {error === "time" ? text("errors.time") : text("errors.window")}
        </p>
      )}
    </div>
  );
}
