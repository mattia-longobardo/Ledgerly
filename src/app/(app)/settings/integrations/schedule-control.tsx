"use client";

import { Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { type ComponentProps, type KeyboardEvent, useId, useMemo, useState, useTransition } from "react";
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
import { cn } from "@/ui/cn";
import { Field } from "@/ui/field";
import { Checkbox, Input, Select } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { Segmented } from "@/ui/segmented";
import { notify } from "@/ui/toast";
import { saveScheduleAction } from "./actions";
import { describeEvery, describeRule, describeSchedule, type T, weekdayNames } from "./schedule-describe";
import {
  type DayChoice,
  dayChoice,
  isWindowed,
  normalizeTime,
  REPEAT_MINUTES,
  type ScheduleForm,
  scheduleForm,
  WHOLE_DAY,
} from "./schedule-form";

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
  if (normalizeTime(draft.from) === null || normalizeTime(draft.until) === null) return "time";
  return "window";
}

/**
 * When a connection syncs, and when it will next (docs/scheduler.md): the one control of the whole
 * app, on Settings › Integrations, on a service's Connection tab and on Time off › Settings. The
 * dialog asks in four modes — repeat, at set times, manual only, custom rules — and previews the
 * coming passes as the person types, with the same functions the server uses. Every time is local
 * to the zone of the person's preferences.
 */
export function ScheduleControl({
  provider,
  name,
  schedule,
  recommended,
  next,
  timeZone,
}: {
  provider: string;
  /** What the dialog's title calls the connection. */
  name: string;
  schedule: SyncSchedule;
  /** What "Use recommended" fills in: this connection's default. */
  recommended: SyncSchedule;
  next: string | null;
  timeZone: string;
}) {
  const t = useTranslations("settings.integrations.scheduleControl");
  const say = t as unknown as T;
  const locale = useLocale() === "it" ? "it-IT" : "en-US";
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="min-w-0 font-medium"
          title={schedule.rules.map((rule) => describeRule(rule, say, locale)).join("\n")}
        >
          {describeSchedule(schedule, say, locale)}
        </span>
        <Button size="xs" onClick={() => setOpen(true)} aria-label={t("change")}>
          {t("changeShort")}
        </Button>
      </div>
      <div className="mt-0.5 text-sm text-muted">{next ? t("next", { when: next }) : t("noNext")}</div>
      {open && (
        <ScheduleDialog
          provider={provider}
          name={name}
          schedule={schedule}
          recommended={recommended}
          timeZone={timeZone}
          locale={locale}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

type Mode = ScheduleForm["mode"];
const MODES: Mode[] = ["repeat", "times", "manual", "custom"];

/** What the simple modes hold. All of it is kept while the mode changes, so going back loses nothing. */
interface Simple {
  mode: Mode;
  every: number;
  windowed: boolean;
  from: string;
  until: string;
  times: string[];
  days: DaysDraft;
  choice: DayChoice;
  drafts: Draft[];
}

function simpleFrom(schedule: SyncSchedule): Simple {
  const form = scheduleForm(schedule);
  const repeat = form.mode === "repeat" ? form : null;
  const days = form.mode === "repeat" || form.mode === "times" ? form.days : undefined;
  return {
    mode: form.mode,
    every: repeat?.everyMinutes ?? 60,
    windowed: repeat ? isWindowed(repeat.from, repeat.until) : false,
    from: repeat && isWindowed(repeat.from, repeat.until) ? repeat.from : "08:00",
    until: repeat && isWindowed(repeat.from, repeat.until) ? repeat.until : "19:00",
    times: form.mode === "times" ? form.times : ["07:30", "22:30"],
    days: daysDraft(days),
    choice: days ? dayChoice(days) : "every",
    drafts: form.mode === "custom" ? form.rules.map(toDraft) : [],
  };
}

/** The rule drafts a state stands for: every check and the preview read these, in any mode. */
function draftsOf(state: Simple): Draft[] {
  if (state.mode === "manual") return [];
  if (state.mode === "custom") return state.drafts;
  if (state.mode === "times") return [{ kind: "times", times: state.times, days: state.days }];
  return [
    {
      kind: "interval",
      every: String(state.every),
      unit: "minutes",
      from: state.windowed ? state.from : WHOLE_DAY.from,
      until: state.windowed ? state.until : WHOLE_DAY.until,
      days: state.days,
    },
  ];
}

function ScheduleDialog({
  provider,
  name,
  schedule,
  recommended,
  timeZone,
  locale,
  onClose,
}: {
  provider: string;
  name: string;
  schedule: SyncSchedule;
  recommended: SyncSchedule;
  timeZone: string;
  locale: string;
  onClose: () => void;
}) {
  const t = useTranslations("settings.integrations.scheduleControl");
  const say = t as unknown as T;
  const [state, setState] = useState<Simple>(() => simpleFrom(schedule));
  const [serverError, setServerError] = useState<string | null>(null);
  const previewId = useId();
  const groupName = useId();
  const [pending, startTransition] = useTransition();
  // The present the preview is measured from: fixed while the dialog is open, so the list does not
  // move under the person's eyes as they type.
  const [now] = useState(() => new Date());

  const drafts = draftsOf(state);
  const errors = drafts.map(ruleError);
  const parsed = syncScheduleSchema.safeParse({ rules: drafts.map(fromDraft) });
  const valid = parsed.success && errors.every((error) => error === null);
  const problems: ScheduleProblem[] = useMemo(
    () => (valid && parsed.success ? scheduleProblems(parsed.data, civilDateIn(now, timeZone)) : []),
    // `parsed` is a new object every render; the state is what it is made of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, valid, now, timeZone],
  );
  const preview = useMemo(
    () =>
      valid && parsed.success && problems.length === 0
        ? nextSyncTimes(parsed.data, timeZone, now, PREVIEW)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, valid, problems, now, timeZone],
  );
  const savable = valid && problems.length === 0;

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

  const update = (index: number, draft: Draft) =>
    setState((all) => ({ ...all, drafts: all.drafts.map((one, at) => (at === index ? draft : one)) }));

  function chooseMode(mode: Mode) {
    setState((all) => ({
      ...all,
      mode,
      // Custom starts from what the person was looking at, as rules they can now edit one by one.
      drafts: mode === "custom" && all.drafts.length === 0 ? draftsOf(all) : all.drafts,
    }));
  }

  function chooseDays(choice: DayChoice) {
    setState((all) => {
      const kind = choice === "every" ? "every" : choice === "month" ? "monthDays" : "weekdays";
      const weekdays = choice === "workdays" ? WORKDAYS : all.days.weekdays;
      return { ...all, choice, days: { ...all.days, kind, weekdays } };
    });
  }

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

  const problem = problems.find((one) => one.code === "tooFrequent");
  const dayOptions: DayChoice[] = ["every", "workdays", "pick", "month"];

  return (
    <Modal
      open
      onOpenChange={(value) => !value && onClose()}
      title={t("titleFor", { name })}
      description={t.rich("description", {
        timeZone,
        link: (chunks) => (
          <Link href="/settings/profile" className="focus-ring rounded-[4px] text-accent underline">
            {chunks}
          </Link>
        ),
      })}
      width={680}
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
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
        <div className="flex min-w-0 flex-col gap-3">
          {serverError && (
            <p role="alert" className="text-sm text-neg">
              {serverError}
            </p>
          )}

          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="sr-only">{t("modes.label")}</legend>
            {MODES.map((mode) => (
              <div
                key={mode}
                className={cn(
                  "flex min-w-0 flex-col gap-3 rounded-ctl border p-3",
                  state.mode === mode ? "border-accent bg-sel" : "border-border",
                )}
              >
                <label className="flex min-h-6 cursor-pointer items-start gap-2">
                  <input
                    type="radio"
                    name={groupName}
                    value={mode}
                    checked={state.mode === mode}
                    onChange={() => chooseMode(mode)}
                    className="focus-ring mt-px size-4 shrink-0 accent-primary"
                  />
                  <span className="flex flex-col">
                    <span className="font-medium">{t(`modes.${mode}`)}</span>
                    {mode !== "repeat" && (
                      <span className="text-sm text-muted">{t(`modes.${mode}Hint`)}</span>
                    )}
                  </span>
                </label>

                {state.mode === "repeat" && mode === "repeat" && (
                  <RepeatFields
                    state={state}
                    error={errors[0]}
                    onChange={(patch) => setState((all) => ({ ...all, ...patch }))}
                  />
                )}
                {state.mode === "times" && mode === "times" && (
                  <TimesEditor
                    times={state.times}
                    onChange={(times) => setState((all) => ({ ...all, times }))}
                  />
                )}
                {state.mode === "custom" && mode === "custom" && (
                  <div className="flex min-w-0 flex-col gap-3">
                    {state.drafts.length === 0 && (
                      <p className="rounded-ctl border border-dashed border-border bg-card p-3 text-sm text-muted">
                        {t("manualHint")}
                      </p>
                    )}
                    {state.drafts.map((draft, index) => (
                      <RuleEditor
                        key={index}
                        index={index}
                        draft={draft}
                        error={errors[index]}
                        neverRuns={problems.some((one) => one.code === "neverRuns" && one.rule === index)}
                        locale={locale}
                        onChange={(next) => update(index, next)}
                        onRemove={() =>
                          setState((all) => ({
                            ...all,
                            drafts: all.drafts.filter((_, at) => at !== index),
                          }))
                        }
                      />
                    ))}
                    {state.drafts.length < MAX_RULES && (
                      <div>
                        <Button
                          size="sm"
                          icon={<Plus className="size-3.5" aria-hidden />}
                          onClick={() =>
                            setState((all) => ({ ...all, drafts: [...all.drafts, blankDraft("times")] }))
                          }
                        >
                          {t("addRule")}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </fieldset>

          {(state.mode === "repeat" || state.mode === "times") && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium" aria-hidden>
                {t("days.label")}
              </span>
              <Segmented
                label={t("days.label")}
                value={state.choice}
                onChange={chooseDays}
                options={dayOptions.map((value) => ({ value, label: t(`days.choices.${value}`) }))}
              />
              {state.choice === "pick" && (
                <WeekdayChips
                  label={t("days.weekdaysLabel")}
                  locale={locale}
                  weekdays={state.days.weekdays}
                  onChange={(weekdays) => setState((all) => ({ ...all, days: { ...all.days, weekdays } }))}
                />
              )}
              {state.choice === "month" && (
                <MonthDayChips
                  label={t("days.monthDaysLabel")}
                  monthDays={state.days.monthDays}
                  onChange={(monthDays) => setState((all) => ({ ...all, days: { ...all.days, monthDays } }))}
                />
              )}
              {errors[0] === "days" && (
                <p role="alert" className="text-sm text-neg">
                  {t("errors.days")}
                </p>
              )}
            </div>
          )}

          <div>
            <Button
              size="xs"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setState(simpleFrom(recommended));
                setServerError(null);
              }}
            >
              {t("useRecommended", { schedule: describeSchedule(recommended, say, locale) })}
            </Button>
          </div>
        </div>

        <section
          aria-labelledby={previewId}
          className="flex min-w-0 flex-col gap-1.5 rounded-ctl bg-hover p-3 sm:sticky sm:top-0"
        >
          <h3 id={previewId} className="text-sm font-medium">
            {t("preview.title")}
          </h3>
          <div aria-live="polite">
            {drafts.length === 0 ? (
              <p className="text-sm text-muted">{t("preview.manual")}</p>
            ) : !valid ? (
              <p className="text-sm text-neg">{t("preview.fix")}</p>
            ) : problem?.code === "tooFrequent" ? (
              <p className="text-sm text-neg">
                {t("errors.tooFrequent", {
                  first: problem.first,
                  second: problem.second,
                  minutes: MIN_SYNC_GAP_MINUTES,
                })}
              </p>
            ) : problems.length > 0 ? (
              <p className="text-sm text-neg">{t("preview.fix")}</p>
            ) : (
              // Three on a phone: the list has to stay on the same screen as the fields it answers.
              <ol
                aria-labelledby={previewId}
                className="flex flex-col gap-0.5 text-sm tabular-nums max-sm:[&>li:nth-child(n+4)]:hidden"
              >
                {preview.map((instant) => (
                  <li key={instant.getTime()}>{when.format(instant)}</li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </div>
    </Modal>
  );
}

function RepeatFields({
  state,
  error,
  onChange,
}: {
  state: Simple;
  error: string | null | undefined;
  onChange: (patch: Partial<Simple>) => void;
}) {
  const t = useTranslations("settings.integrations.scheduleControl");
  const say = t as unknown as T;
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-every`} className="text-sm font-medium">
          {t("every")}
        </label>
        <Select
          id={`${id}-every`}
          value={state.every}
          onChange={(event) => onChange({ every: Number(event.target.value) })}
          className="w-auto"
        >
          {REPEAT_MINUTES.map((minutes) => (
            <option key={minutes} value={minutes}>
              {describeEvery(minutes, say)}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox
          label={t("onlyBetween")}
          checked={state.windowed}
          onChange={(event) => onChange({ windowed: event.target.checked })}
        />
        {state.windowed && (
          <span className="flex items-center gap-1.5">
            <TimeInput
              aria-label={t("from")}
              value={state.from}
              invalid={error === "window" || error === "time"}
              onValue={(from) => onChange({ from })}
            />
            <span aria-hidden className="text-sm">
              –
            </span>
            <TimeInput
              aria-label={t("until")}
              value={state.until}
              invalid={error === "window" || error === "time"}
              onValue={(until) => onChange({ until })}
            />
          </span>
        )}
      </div>
      {(error === "window" || error === "time") && (
        <p role="alert" className="text-sm text-neg">
          {t(`errors.${error}`)}
        </p>
      )}
    </div>
  );
}

/**
 * A time of day in 24 hours, written the way the summary and the preview write it. Text and not
 * `type="time"`: see `normalizeTime`. It is put in its proper form when the field is left.
 */
function TimeInput({
  value,
  onValue,
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: string;
  onValue: (value: string) => void;
}) {
  return (
    <Input
      {...props}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={5}
      placeholder="HH:MM"
      value={value}
      onChange={(event) => onValue(event.target.value)}
      onBlur={() => onValue(normalizeTime(value) ?? value)}
      className={cn("w-[72px] tabular-nums", className)}
    />
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
    <fieldset className="flex min-w-0 flex-col gap-3 rounded-ctl border border-border bg-card p-3">
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
            <TimeInput
              id={`${id}-from`}
              value={draft.from}
              invalid={error === "window" || error === "time"}
              onValue={(from) => onChange({ ...draft, from })}
            />
          </Field>
          <Field label={t("until")} htmlFor={`${id}-until`}>
            <TimeInput
              id={`${id}-until`}
              value={draft.until}
              invalid={error === "window" || error === "time"}
              onValue={(until) => onChange({ ...draft, until })}
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
  /** Which rule the times belong to, under "Custom rules"; a simple mode has only one list. */
  n?: number;
  times: string[];
  onChange: (times: string[]) => void;
}) {
  const t = useTranslations("settings.integrations.scheduleControl");
  const id = useId();
  const [time, setTime] = useState("12:00");
  const [refused, setRefused] = useState(false);

  function add() {
    const normal = normalizeTime(time);
    setRefused(normal === null);
    if (normal === null || times.includes(normal)) return;
    setTime(normal);
    onChange([...times, normal].sort((a, b) => minutesOf(a) - minutesOf(b)));
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
                aria-label={n ? t("removeTime", { time: one, n }) : t("removeTimeSimple", { time: one })}
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
          <TimeInput
            aria-label={n ? t("newTime", { n }) : t("newTimeSimple")}
            value={time}
            invalid={refused}
            onValue={(value) => {
              setTime(value);
              setRefused(false);
            }}
            onKeyDown={onKeyDown}
          />
          <Button size="sm" onClick={add}>
            {t("addTime")}
          </Button>
        </div>
      )}
      {refused && (
        <p role="alert" className="text-sm text-neg">
          {t("errors.time")}
        </p>
      )}
    </div>
  );
}

const toggled = (list: number[], value: number) =>
  list.includes(value) ? list.filter((one) => one !== value) : [...list, value].sort((a, b) => a - b);

function WeekdayChips({
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
      {short.map((name, at) => (
        <Chip
          key={name}
          active={weekdays.includes(at + 1)}
          aria-label={long[at]}
          onClick={() => onChange(toggled(weekdays, at + 1))}
          className="min-w-10 justify-center"
        >
          {name}
        </Chip>
      ))}
    </div>
  );
}

function MonthDayChips({
  label,
  monthDays,
  onChange,
}: {
  label: string;
  monthDays: number[];
  onChange: (monthDays: number[]) => void;
}) {
  const t = useTranslations("settings.integrations.scheduleControl");
  return (
    <div role="group" aria-label={label} className="grid grid-cols-7 gap-1">
      {Array.from({ length: 31 }, (_, at) => at + 1).map((day) => (
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
        {t("days.lastLong")}
      </Chip>
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
        <WeekdayChips
          label={t("days.weekdaysOf", { n })}
          locale={locale}
          weekdays={days.weekdays}
          onChange={(weekdays) => onChange({ ...days, weekdays })}
        />
      )}
      {days.kind === "monthDays" && (
        <MonthDayChips
          label={t("days.monthDaysOf", { n })}
          monthDays={days.monthDays}
          onChange={(monthDays) => onChange({ ...days, monthDays })}
        />
      )}
    </div>
  );
}
