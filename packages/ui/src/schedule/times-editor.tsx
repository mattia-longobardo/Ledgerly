"use client";

import { MAX_TIMES } from "@ledgerly/api-contract/settings";
import { X } from "lucide-react";
import { type KeyboardEvent, useId, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { Button } from "../button";
import { normalizeTime } from "./form";
import { TimeInput } from "./time-input";

/** The times already in the rule, each with the button that removes it. */
function TimeChips({
  labelId,
  number,
  times,
  onRemove,
}: {
  labelId: string;
  number?: number;
  times: string[];
  onRemove: (time: string) => void;
}) {
  const text = useTranslations("settings.integrations.scheduleControl");
  if (times.length === 0) return null;
  return (
    <ul aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
      {times.map((one) => (
        <li
          key={one}
          className="inline-flex h-7 items-center gap-0.5 rounded-[14px] border border-border bg-card pr-0.5 pl-2.5 text-sm tabular-nums"
        >
          {one}
          <button
            type="button"
            aria-label={
              number ? text("removeTime", { time: one, n: number }) : text("removeTimeSimple", { time: one })
            }
            onClick={() => onRemove(one)}
            className="focus-ring inline-grid size-6 place-items-center rounded-full text-muted hover:bg-hover hover:text-fg"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The times of a rule, as chips, and the field that adds one. */
export function TimesEditor({
  number,
  times,
  onChange,
}: {
  /** Which rule the times belong to, under "Custom rules"; a simple mode has only one list. */
  number?: number;
  times: string[];
  onChange: (times: string[]) => void;
}) {
  const text = useTranslations("settings.integrations.scheduleControl");
  const id = useId();
  const [time, setTime] = useState("12:00");
  const [refused, setRefused] = useState(false);
  const entry = useRef<HTMLDivElement>(null);

  /**
   * Removes a time and puts the focus on the field for a new one, before the button that was
   * pressed leaves the page: a focus left on nothing is a place lost for whoever uses the
   * keyboard, and the dialog takes it back a moment later, from whatever is being typed by then.
   */
  function remove(one: string) {
    entry.current?.querySelector("input")?.focus();
    onChange(times.filter((other) => other !== one));
  }

  // "HH:MM" in 24 hours sorts as text in the order of the day.
  function add() {
    const normal = normalizeTime(time);
    setRefused(normal === null);
    if (normal === null || times.includes(normal)) return;
    setTime(normal);
    onChange([...times, normal].sort());
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) =>
    event.key === "Enter" && (event.preventDefault(), add());

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium" id={`${id}-label`}>
        {text("at")}
      </span>
      <TimeChips labelId={`${id}-label`} number={number} times={times} onRemove={remove} />
      {times.length < MAX_TIMES && (
        <div ref={entry} className="flex items-center gap-1.5">
          <TimeInput
            aria-label={number ? text("newTime", { n: number }) : text("newTimeSimple")}
            value={time}
            invalid={refused}
            onValue={(value) => {
              setTime(value);
              setRefused(false);
            }}
            onKeyDown={onKeyDown}
          />
          <Button size="sm" onClick={add}>
            {text("addTime")}
          </Button>
        </div>
      )}
      {refused && (
        <p role="alert" className="text-sm text-neg">
          {text("errors.time")}
        </p>
      )}
    </div>
  );
}
