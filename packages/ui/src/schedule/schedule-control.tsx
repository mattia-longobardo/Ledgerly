"use client";

// When a connection syncs, and when it will next (docs/scheduler.md, audit UI-SET-2): the one control
// of the whole app, on Settings › Integrations, on a service's Connection tab and on Time off ›
// Settings. The dialog asks in four modes — repeat, at set times, manual only, custom rules — and
// shows the coming passes as the person types: the container says how a schedule is previewed and
// saved (on the web, `/api/v1/connections/{id}/schedule`). Every time is local to the person's zone.
import { intlLocale } from "@ledgerly/format/format";
import { useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import { Button } from "../button";
import { describeRule, describeSchedule } from "./describe";
import type { PreviewSchedule } from "./preview";
import { type SaveSchedule, ScheduleDialog } from "./schedule-dialog";
import type { SyncSchedule } from "./types";

export type { PreviewSchedule } from "./preview";
export type { SaveSchedule } from "./schedule-dialog";
export type { SyncSchedule } from "./types";

export function ScheduleControl({
  name,
  schedule,
  recommended,
  next,
  timeZone,
  maxPerDay,
  save,
  preview,
}: {
  /** What the dialog's title calls the connection. */
  name: string;
  schedule: SyncSchedule;
  /** What "Use recommended" fills in: this connection's default. */
  recommended: SyncSchedule;
  /** The next pass, already written for the reader; null when none is planned. */
  next: string | null;
  timeZone: string;
  /** The most passes a day this connection allows: the "Repeat" intervals over it are disabled. */
  maxPerDay?: number;
  save: SaveSchedule;
  preview: PreviewSchedule;
}) {
  const text = useTranslations("settings.integrations.scheduleControl");
  const locale = intlLocale(useLocale());
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="min-w-0 font-medium"
          title={schedule.rules.map((rule) => describeRule(rule, text, locale)).join("\n")}
        >
          {describeSchedule(schedule, text, locale)}
        </span>
        <Button size="xs" onClick={() => setOpen(true)} aria-label={text("change")}>
          {text("changeShort")}
        </Button>
      </div>
      <div className="mt-0.5 text-sm text-muted">{next ? text("next", { when: next }) : text("noNext")}</div>
      {open && (
        <ScheduleDialog
          name={name}
          schedule={schedule}
          recommended={recommended}
          timeZone={timeZone}
          locale={locale}
          maxPerDay={maxPerDay}
          save={save}
          preview={preview}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
