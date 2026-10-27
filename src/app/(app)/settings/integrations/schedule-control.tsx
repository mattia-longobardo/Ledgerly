"use client";

import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import {
  MAX_SYNC_TIMES,
  SYNC_INTERVALS,
  type SyncInterval,
  type SyncSchedule,
} from "@/platform/integrations/rules";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input, Select } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { Segmented } from "@/ui/segmented";
import { notify } from "@/ui/toast";
import { saveScheduleAction } from "./actions";

type Mode = SyncSchedule["mode"];

/**
 * "Sync" on a provider card (docs/auth-design.md D7): when this connection syncs, in one of three
 * shapes, and when it will next. The times are the person's own local times — the zone of their
 * preferences, named under the form — and the server works out the next pass, not the browser.
 */
export function ScheduleControl({
  provider,
  schedule,
  next,
  timeZone,
}: {
  provider: string;
  schedule: SyncSchedule;
  next: string | null;
  timeZone: string;
}) {
  const t = useTranslations("settings.integrations.scheduleControl");
  const id = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(schedule.mode);
  const [every, setEvery] = useState<SyncInterval>(schedule.mode === "interval" ? schedule.everyMinutes : 60);
  const [times, setTimes] = useState<string[]>(schedule.mode === "times" ? schedule.times : ["07:00"]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const summary =
    schedule.mode === "manual"
      ? t("summary.manual")
      : schedule.mode === "interval"
        ? t(`intervals.${schedule.everyMinutes}`)
        : t("summary.times", { times: schedule.times.join(", ") });

  function save() {
    const value: SyncSchedule =
      mode === "manual"
        ? { mode }
        : mode === "interval"
          ? { mode, everyMinutes: every }
          : { mode, times: times.filter(Boolean) };
    startTransition(async () => {
      const result = await saveScheduleAction(provider, value);
      if (!result.ok) {
        setError(t("invalid"));
        return;
      }
      setError(null);
      setOpen(false);
      notify(t("saved"));
    });
  }

  return (
    <>
      <div className="mt-0.5 flex items-center gap-2">
        <span className="font-medium whitespace-nowrap">{summary}</span>
        <Button size="xs" onClick={() => setOpen(true)} aria-label={t("change")}>
          {t("changeShort")}
        </Button>
      </div>
      <div className="mt-0.5 text-sm whitespace-nowrap text-muted">
        {next ? t("next", { when: next }) : t("noNext")}
      </div>

      <Modal
        open={open}
        onOpenChange={(value) => !value && setOpen(false)}
        title={t("title")}
        description={t("description", { timeZone })}
        width={460}
        footer={
          <>
            <Button size="sm" onClick={() => setOpen(false)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button size="sm" variant="primary" onClick={save} disabled={pending}>
              {t("save")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {error && (
            <p role="alert" className="text-sm text-neg">
              {error}
            </p>
          )}
          <Segmented
            label={t("mode")}
            value={mode}
            onChange={setMode}
            options={[
              { value: "interval", label: t("modes.interval") },
              { value: "times", label: t("modes.times") },
              { value: "manual", label: t("modes.manual") },
            ]}
          />
          {mode === "interval" && (
            <Field label={t("every")} htmlFor={`${id}-every`}>
              <Select
                id={`${id}-every`}
                value={String(every)}
                onChange={(event) => setEvery(Number(event.target.value) as SyncInterval)}
              >
                {SYNC_INTERVALS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {t(`intervals.${minutes}`)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {mode === "times" && (
            <fieldset className="flex flex-col gap-2">
              <legend className="pb-1 text-sm font-medium">{t("at")}</legend>
              {times.map((time, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    type="time"
                    step={900}
                    aria-label={t("timeLabel", { n: index + 1 })}
                    value={time}
                    onChange={(event) =>
                      setTimes((all) => all.map((one, at) => (at === index ? event.target.value : one)))
                    }
                    className="w-32"
                  />
                  {times.length > 1 && (
                    <Button
                      size="xs"
                      onClick={() => setTimes((all) => all.filter((_, at) => at !== index))}
                      aria-label={t("removeTime", { n: index + 1 })}
                    >
                      {t("remove")}
                    </Button>
                  )}
                </div>
              ))}
              {times.length < MAX_SYNC_TIMES && (
                <div>
                  <Button size="xs" onClick={() => setTimes((all) => [...all, "19:00"])}>
                    {t("addTime")}
                  </Button>
                </div>
              )}
              <p className="text-sm text-muted">{t("timesHint")}</p>
            </fieldset>
          )}
          {mode === "manual" && <p className="text-sm text-muted">{t("manualHint")}</p>}
          <p className="text-sm text-muted">{t("dependentHint")}</p>
        </div>
      </Modal>
    </>
  );
}
