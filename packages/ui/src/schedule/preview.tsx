"use client";

import { MIN_SYNC_GAP_MINUTES } from "@ledgerly/api-contract";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import type { SchedulePreview, SyncSchedule } from "./types";

/** Asks for the preview of a schedule: the server's answer on the web, an answer at once in a test. */
export type PreviewSchedule = (schedule: SyncSchedule) => SchedulePreview | Promise<SchedulePreview>;

const NOTHING: SchedulePreview = { next: [], problems: [] };

const isPending = (answer: SchedulePreview | Promise<SchedulePreview>): answer is Promise<SchedulePreview> =>
  "then" in answer;

/**
 * The preview of the schedule on screen, asked once per schedule: `undefined` while its answer is on
 * the way. A schedule with no rule needs no question: nothing runs by itself.
 */
export function usePreview(
  schedule: SyncSchedule | null,
  preview: PreviewSchedule,
): SchedulePreview | null | undefined {
  // The schedule is rebuilt at every keystroke: its text is what says whether it changed.
  const key = schedule && schedule.rules.length > 0 ? JSON.stringify(schedule) : null;
  const asked = useMemo(() => (key === null ? null : preview(JSON.parse(key))), [key, preview]);
  const [settled, setSettled] = useState<{ key: string; answer: SchedulePreview } | null>(null);
  useEffect(() => {
    if (key === null || asked === null || !isPending(asked)) return;
    let current = true;
    // A preview that cannot be had says nothing: the server checks the schedule again on Save.
    asked.catch(() => NOTHING).then((answer) => current && setSettled({ key, answer }));
    return () => {
      current = false;
    };
  }, [key, asked]);
  if (!schedule) return null;
  if (asked === null) return NOTHING;
  if (!isPending(asked)) return asked;
  return settled?.key === key ? settled.answer : undefined;
}

/** The next passes, or what is wrong with the rules, beside the fields they answer. */
export function PreviewPanel({
  headingId,
  manual,
  valid,
  answer,
  timeZone,
  locale,
}: {
  headingId: string;
  manual: boolean;
  valid: boolean;
  answer: SchedulePreview | null | undefined;
  timeZone: string;
  locale: string;
}) {
  const text = useTranslations("settings.integrations.scheduleControl");
  const common = useTranslations("common");
  // 24 hours whatever the language: the summary on the card and the time fields write it that way.
  const when = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const problems = answer?.problems ?? [];
  const tooFrequent = problems.find((one) => one.code === "tooFrequent");
  if (manual) return <p className="text-sm text-muted">{text("preview.manual")}</p>;
  if (!valid) return <p className="text-sm text-neg">{text("preview.fix")}</p>;
  if (answer === undefined) return <p className="text-sm text-muted">{common("loading")}</p>;
  if (tooFrequent?.code === "tooFrequent") {
    return (
      <p className="text-sm text-neg">
        {text("errors.tooFrequent", {
          first: tooFrequent.first,
          second: tooFrequent.second,
          minutes: MIN_SYNC_GAP_MINUTES,
        })}
      </p>
    );
  }
  if (problems.length > 0) return <p className="text-sm text-neg">{text("preview.fix")}</p>;
  return (
    // Three on a phone: the list has to stay on the same screen as the fields it answers.
    <ol
      aria-labelledby={headingId}
      className="flex flex-col gap-0.5 text-sm tabular-nums max-sm:[&>li:nth-child(n+4)]:hidden"
    >
      {(answer?.next ?? []).map((instant) => (
        <li key={instant}>{when.format(new Date(instant))}</li>
      ))}
    </ol>
  );
}
