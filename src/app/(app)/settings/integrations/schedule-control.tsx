"use client";

import { Plus, Trash2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type KeyboardEvent, useId, useMemo, useState, useTransition } from "react";
import { civilDateIn } from "@/platform/dates";
import {
  LAST_DAY,
  MAX_RULES,
  MAX_TIMES,
  MIN_SYNC_GAP_MINUTES,
  minutesOf,
  nextSyncTimes,
  type RuleKind,
  type ScheduleProblem,
  type SyncDays,
  type SyncRule,
  type SyncSchedule,
  syncRuleSchema,
  syncScheduleSchema,
  scheduleProblems,
} from "@/platform/integrations/schedule";
import { Button, Chip, IconButton } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input, Select } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import { saveScheduleAction } from "./actions";
import { describeRule, describeSchedule, type T, weekdayNames } from "./schedule-describe";
import { PRESETS } from "./schedule-presets";

/** How many coming passes the preview lists. */
const PREVIEW = 5;

type Unit = "minutes" | "hours";
type DaysKind = SyncDays["kind"];

/** The days of a rule as edited: both lists are kept, so switching between them loses nothing. */
interface DaysDraft {
  kind: DaysKind;
  weekdays: number[];
  monthDays: number[];
}

/** A rule as the form holds it: what the person typed, valid or not yet. */
type Draft =
  | { kind: "interval"; every: string; unit: Unit; from: string; until: string; days: DaysDraft }
  | { kind: "times"; times: string[]; days: DaysDraft }
  | { kind: "cron"; expression: string };

const WORKDAYS = [1, 2, 3, 4, 5];

function daysDraft(days?: SyncDays): DaysDraft {
  return {
    kind: days?.kind ?? "every",
    weekdays: days?.kind === "weekdays" ? days.weekdays : WORKDAYS,
    monthDays: days?.kind === "monthDays" ? days.monthDays : [1],
  };
}

function toDraft(rule: SyncRule): Draft {
  if (rule.kind === "cron") return { kind: "cron", expression: rule.expression };
  if (rule.kind === "times") return { kind: "times", times: rule.times, days: daysDraft(rule.days) };
  const hours = rule.everyMinutes % 60 === 0;
  return {
    kind: "interval",
    every: String(hours ? rule.everyMinutes / 60 : rule.everyMinutes),
    unit: hours ? "hours" : "minutes",
    from: rule.from,
    until: rule.until,
    days: daysDraft(rule.days),
  };
}

function blankDraft(kind: RuleKind): Draft {
  if (kind === "cron") return { kind, expression: "0 7 * * 1-5" };
  if (kind === "times") return { kind, times: ["07:00"], days: daysDraft() };
  return { kind, every: "1", unit: "hours", from: "00:00", until: "23:59", days: daysDraft() };
}

function fromDays(days: DaysDraft): SyncDays {
  if (days.kind === "weekdays") return { kind: "weekdays", weekdays: days.weekdays };
  if (days.kind === "monthDays") return { kind: "monthDays", monthDays: days.monthDays };
  return { kind: "every" };
}

/** A draft as the rule it stands for — unchecked: the schema says whether it is one. */
function fromDraft(draft: Draft): unknown {
  if (draft.kind === "cron") return { kind: "cron", expression: draft.expression };
  if (draft.kind === "times") return { kind: "times", times: draft.times, days: fromDays(draft.days) };
  const every = Number(draft.every);
  return {
    kind: "interval",
    everyMinutes: draft.every.trim() === "" ? NaN : draft.unit === "hours" ? every * 60 : every,
    from: draft.from,
    until: draft.until,
    days: fromDays(draft.days),
  };
}

/** Why one rule does not parse, as a `errors.*` catalogue key; null when it does. */
function ruleError(draft: Draft): string | null {
  const parsed = syncRuleSchema.safeParse(fromDraft(draft));
  if (parsed.success) return null;
  if (draft.kind === "cron") return "cron";
  const paths = parsed.error.issues.map((issue) => issue.path.join("."));
  if (paths.some((path) => path.startsWith("days"))) return "days";
  if (draft.kind === "times") return "times";
  if (paths.includes("everyMinutes")) return "every";
  return "window";
}

/**
 * "Sync" on a provider card (docs/scheduler.md): when this connection syncs, and when it will
 * next. The dialog edits a list of rules — every N minutes in a window, at chosen times, or a cron
 * expression, each on chosen days — and previews the coming passes as the person types, with the
 * same functions the server uses. Every time is local to the zone of the person's preferences.
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
  const say = t as unknown as T;
  const locale = useLocale() === "it" ? "it-IT" : "en-US";
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="mt-0.5 flex min-w-0 items-center gap-2">
        <span
          className="truncate font-medium"
          title={schedule.rules.map((rule) => describeRule(rule, say, locale)).join("\n")}
        >
          {describeSchedule(schedule, say, locale)}
        </span>
        <Button size="xs" onClick={() => setOpen(true)} aria-label={t("change")}>
          {t("changeShort")}
        </Button>
      </div>
      <div className="mt-0.5 text-sm whitespace-nowrap text-muted">
        {next ? t("next", { when: next }) : t("noNext")}
      </div>
      {open && (
        <ScheduleDialog
          provider={provider}
          schedule={schedule}
          timeZone={timeZone}
          locale={locale}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ScheduleDialog({
  provider,
  schedule,
  timeZone,
  locale,
  onClose,
}: {
  provider: string;
  schedule: SyncSchedule;
  timeZone: string;
  locale: string;
  onClose: () => void;
}) {
  const t = useTranslations("settings.integrations.scheduleControl");
  const [drafts, setDrafts] = useState<Draft[]>(() => schedule.rules.map(toDraft));
  const [serverError, setServerError] = useState<string | null>(null);
  const previewId = useId();
  const [pending, startTransition] = useTransition();
  // The present the preview is measured from: fixed while the dialog is open, so the list does not
  // move under the person's eyes as they type.
  const [now] = useState(() => new Date());

  const errors = drafts.map(ruleError);
  const parsed = syncScheduleSchema.safeParse({ rules: drafts.map(fromDraft) });
  const valid = parsed.success && errors.every((error) => error === null);
  const problems: ScheduleProblem[] = useMemo(
    () => (valid && parsed.success ? scheduleProblems(parsed.data, civilDateIn(now, timeZone)) : []),
    // `parsed` is a new object every render; the drafts are what it is made of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drafts, valid, now, timeZone],
  );
  const preview = useMemo(
    () =>
      valid && parsed.success && problems.length === 0
        ? nextSyncTimes(parsed.data, timeZone, now, PREVIEW)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drafts, valid, problems, now, timeZone],
  );
  const savable = valid && problems.length === 0;

  const when = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const update = (index: number, draft: Draft) =>
    setDrafts((all) => all.map((one, at) => (at === index ? draft : one)));

  function save() {
    if (!parsed.success) return;
    startTransition(async () => {
      const result = await saveScheduleAction(provider, parsed.data);
      if (!result.ok) {
        setServerError(t("invalid"));
        return;
      }
      setServerError(null);
      onClose();
      notify(t("saved"));
    });
  }

  return (
    <Modal
      open
      onOpenChange={(value) => !value && onClose()}
      title={t("title")}
      description={t("description", { timeZone, minutes: MIN_SYNC_GAP_MINUTES })}
      width={520}
      footer={
        <>
          <Button size="sm" onClick={onClose} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button size="sm" variant="primary" onClick={save} disabled={pending || !savable}>
            {t("save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {serverError && (
          <p role="alert" className="text-sm text-neg">
            {serverError}
          </p>
        )}

        <div role="group" aria-label={t("presets.label")} className="flex flex-col gap-1.5">
          <span className="text-sm font-medium" aria-hidden>
            {t("presets.label")}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <Button
                key={preset.key}
                size="xs"
                onClick={() => setDrafts(preset.rules.map((rule) => toDraft(rule as SyncRule)))}
              >
                {t(`presets.${preset.key}`)}
              </Button>
            ))}
          </div>
        </div>

        {drafts.length === 0 ? (
          <p className="rounded-ctl border border-dashed border-border p-3 text-sm text-muted">
            {t("manualHint")}
          </p>
        ) : (
          drafts.map((draft, index) => (
            <RuleEditor
              key={index}
              index={index}
              draft={draft}
              error={errors[index]}
              neverRuns={problems.some((problem) => problem.code === "neverRuns" && problem.rule === index)}
              locale={locale}
              onChange={(next) => update(index, next)}
              onRemove={() => setDrafts((all) => all.filter((_, at) => at !== index))}
            />
          ))
        )}

        {drafts.length < MAX_RULES && (
          <div>
            <Button
              size="sm"
              icon={<Plus className="size-3.5" aria-hidden />}
              onClick={() => setDrafts((all) => [...all, blankDraft("times")])}
            >
              {t("addRule")}
            </Button>
          </div>
        )}

        <section aria-labelledby={previewId} className="flex flex-col gap-1.5 rounded-ctl bg-hover p-3">
          <h3 id={previewId} className="text-sm font-medium">
            {t("preview.title", { n: PREVIEW })}
          </h3>
          <div aria-live="polite">
            {drafts.length === 0 ? (
              <p className="text-sm text-muted">{t("preview.manual")}</p>
            ) : !valid ? (
              <p className="text-sm text-neg">{t("preview.fix")}</p>
            ) : problems.some((problem) => problem.code === "tooFrequent") ? (
              <p className="text-sm text-neg">
                {(() => {
                  const problem = problems.find((one) => one.code === "tooFrequent");
                  return problem?.code === "tooFrequent"
                    ? t("errors.tooFrequent", {
                        first: problem.first,
                        second: problem.second,
                        minutes: MIN_SYNC_GAP_MINUTES,
                      })
                    : null;
                })()}
              </p>
            ) : problems.length > 0 ? (
              <p className="text-sm text-neg">{t("preview.fix")}</p>
            ) : (
              <ol aria-labelledby={previewId} className="flex flex-col gap-0.5 text-sm tabular-nums">
                {preview.map((instant) => (
                  <li key={instant.getTime()}>{when.format(instant)}</li>
                ))}
              </ol>
            )}
          </div>
        </section>
        <p className="text-sm text-muted">{t("dependentHint")}</p>
      </div>
    </Modal>
  );
}

function RuleEditor({
  index,
  draft,
  error,
  neverRuns,
  locale,
  onChange,
  onRemove,
}: {
  index: number;
  draft: Draft;
  error: string | null;
  neverRuns: boolean;
  locale: string;
  onChange: (draft: Draft) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("settings.integrations.scheduleControl");
  const id = useId();
  const n = index + 1;
  const say = t as unknown as T;
  const message = error
    ? say(`errors.${error}`, { minutes: MIN_SYNC_GAP_MINUTES })
    : neverRuns
      ? t("errors.neverRuns")
      : null;

  return (
    <fieldset className="flex min-w-0 flex-col gap-3 rounded-ctl border border-border p-3">
      <legend className="sr-only">{t("rule", { n })}</legend>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium" aria-hidden>
          {t("rule", { n })}
        </span>
        <Select
          aria-label={t("kindLabel", { n })}
          value={draft.kind}
          onChange={(event) => onChange(blankDraftKeepingDays(draft, event.target.value as RuleKind))}
          className="w-auto min-w-0 flex-1 sm:flex-none"
        >
          <option value="interval">{t("kinds.interval")}</option>
          <option value="times">{t("kinds.times")}</option>
          <option value="cron">{t("kinds.cron")}</option>
        </Select>
        <IconButton label={t("removeRule", { n })} onClick={onRemove} className="ml-auto">
          <Trash2 className="size-4" aria-hidden />
        </IconButton>
      </div>

      {draft.kind === "interval" && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("every")} htmlFor={`${id}-every`}>
            <div className="flex gap-1.5">
              <Input
                id={`${id}-every`}
                type="number"
                inputMode="numeric"
                min={1}
                value={draft.every}
                invalid={error === "every"}
                onChange={(event) => onChange({ ...draft, every: event.target.value })}
                className="w-20"
              />
              <Select
                aria-label={t("unit")}
                value={draft.unit}
                onChange={(event) => onChange({ ...draft, unit: event.target.value as Unit })}
                className="w-auto"
              >
                <option value="minutes">{t("units.minutes")}</option>
                <option value="hours">{t("units.hours")}</option>
              </Select>
            </div>
          </Field>
          <Field label={t("from")} htmlFor={`${id}-from`}>
            <Input
              id={`${id}-from`}
              type="time"
              step={60}
              value={draft.from}
              invalid={error === "window"}
              onChange={(event) => onChange({ ...draft, from: event.target.value })}
              className="w-28"
            />
          </Field>
          <Field label={t("until")} htmlFor={`${id}-until`}>
            <Input
              id={`${id}-until`}
              type="time"
              step={60}
              value={draft.until}
              invalid={error === "window"}
              onChange={(event) => onChange({ ...draft, until: event.target.value })}
              className="w-28"
            />
          </Field>
        </div>
      )}

      {draft.kind === "times" && (
        <TimesEditor n={n} times={draft.times} onChange={(times) => onChange({ ...draft, times })} />
      )}

      {draft.kind === "cron" && (
        <Field label={t("cron")} htmlFor={`${id}-cron`} hint={t("cronHint")}>
          <Input
            id={`${id}-cron`}
            value={draft.expression}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            invalid={error === "cron"}
            onChange={(event) => onChange({ ...draft, expression: event.target.value })}
            className="font-mono"
          />
        </Field>
      )}

      {draft.kind !== "cron" && (
        <DaysEditor
          n={n}
          days={draft.days}
          locale={locale}
          onChange={(days) => onChange({ ...draft, days })}
        />
      )}

      {message && (
        <p role="alert" className="text-sm text-neg">
          {message}
        </p>
      )}
    </fieldset>
  );
}

/** A new kind of rule, keeping the days the person already picked. */
function blankDraftKeepingDays(draft: Draft, kind: RuleKind): Draft {
  const next = blankDraft(kind);
  if (next.kind !== "cron" && draft.kind !== "cron") return { ...next, days: draft.days };
  return next;
}

function TimesEditor({
  n,
  times,
  onChange,
}: {
  n: number;
  times: string[];
  onChange: (times: string[]) => void;
}) {
  const t = useTranslations("settings.integrations.scheduleControl");
  const id = useId();
  const [time, setTime] = useState("12:00");

  function add() {
    if (!/^\d{2}:\d{2}$/.test(time) || times.includes(time)) return;
    onChange([...times, time].sort((a, b) => minutesOf(a) - minutesOf(b)));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      add();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium" id={`${id}-label`}>
        {t("at")}
      </span>
      {times.length > 0 && (
        <ul aria-labelledby={`${id}-label`} className="flex flex-wrap gap-1.5">
          {times.map((one) => (
            <li
              key={one}
              className="inline-flex h-7 items-center gap-0.5 rounded-[14px] border border-border bg-card pr-0.5 pl-2.5 text-sm tabular-nums"
            >
              {one}
              <button
                type="button"
                aria-label={t("removeTime", { time: one, n })}
                onClick={() => onChange(times.filter((other) => other !== one))}
                className="focus-ring inline-grid size-6 place-items-center rounded-full text-muted hover:bg-hover hover:text-fg"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {times.length < MAX_TIMES && (
        <div className="flex items-center gap-1.5">
          <Input
            type="time"
            step={60}
            aria-label={t("newTime", { n })}
            value={time}
            onChange={(event) => setTime(event.target.value)}
            onKeyDown={onKeyDown}
            className="w-28"
          />
          <Button size="sm" onClick={add}>
            {t("addTime")}
          </Button>
        </div>
      )}
    </div>
  );
}

function DaysEditor({
  n,
  days,
  locale,
  onChange,
}: {
  n: number;
  days: DaysDraft;
  locale: string;
  onChange: (days: DaysDraft) => void;
}) {
  const t = useTranslations("settings.integrations.scheduleControl");
  const id = useId();
  const short = weekdayNames(locale);
  const long = weekdayNames(locale, "long");
  const toggle = (list: number[], value: number) =>
    list.includes(value) ? list.filter((one) => one !== value) : [...list, value].sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-2">
      <Field label={t("days.label")} htmlFor={`${id}-days`}>
        <Select
          id={`${id}-days`}
          value={days.kind}
          onChange={(event) => onChange({ ...days, kind: event.target.value as DaysKind })}
          className="w-auto self-start"
        >
          <option value="every">{t("days.every")}</option>
          <option value="weekdays">{t("days.weekdays")}</option>
          <option value="monthDays">{t("days.monthDays")}</option>
        </Select>
      </Field>
      {days.kind === "weekdays" && (
        <div role="group" aria-label={t("days.weekdaysOf", { n })} className="flex flex-wrap gap-1">
          {short.map((name, at) => (
            <Chip
              key={name}
              active={days.weekdays.includes(at + 1)}
              aria-label={long[at]}
              onClick={() => onChange({ ...days, weekdays: toggle(days.weekdays, at + 1) })}
              className="min-w-10 justify-center"
            >
              {name}
            </Chip>
          ))}
        </div>
      )}
      {days.kind === "monthDays" && (
        <div role="group" aria-label={t("days.monthDaysOf", { n })} className="grid grid-cols-7 gap-1">
          {Array.from({ length: 31 }, (_, at) => at + 1).map((day) => (
            <Chip
              key={day}
              active={days.monthDays.includes(day)}
              onClick={() => onChange({ ...days, monthDays: toggle(days.monthDays, day) })}
              className="justify-center px-0 tabular-nums"
            >
              {day}
            </Chip>
          ))}
          <Chip
            active={days.monthDays.includes(LAST_DAY)}
            onClick={() => onChange({ ...days, monthDays: toggle(days.monthDays, LAST_DAY) })}
            className="col-span-3 justify-center"
          >
            {t("days.lastLong")}
          </Chip>
        </div>
      )}
    </div>
  );
}
