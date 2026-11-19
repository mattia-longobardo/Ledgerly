"use client";

// The four modes of the dialog — repeat, at set times, manual only, custom rules — each with its own
// fields under it, and the days of the simple ones.
import { MAX_RULES } from "@ledgerly/api-contract/settings";
import { Plus } from "lucide-react";
import { type ReactNode, useId } from "react";
import { useTranslations } from "use-intl";
import { Button } from "../button";
import { cn } from "../cn";
import { Segmented } from "../segmented";
import { MonthDayChips, WeekdayChips } from "./day-chips";
import {
  blankDraft,
  type Draft,
  draftsOf,
  type Mode,
  MODES,
  type RuleError,
  type Simple,
  WORKDAYS,
} from "./drafts";
import type { DayChoice } from "./form";
import { RepeatFields } from "./repeat-fields";
import { RuleEditor } from "./rule-editor";
import { TimesEditor } from "./times-editor";
import type { ScheduleProblem } from "./types";

export type Patch = (change: (state: Simple) => Simple) => void;

const DAY_CHOICES: DayChoice[] = ["every", "workdays", "pick", "month"];

function chosenMode(state: Simple, mode: Mode): Simple {
  // Custom starts from what the person was looking at, as rules they can now edit one by one.
  return {
    ...state,
    mode,
    drafts: mode === "custom" && state.drafts.length === 0 ? draftsOf(state) : state.drafts,
  };
}

function chosenDays(state: Simple, choice: DayChoice): Simple {
  const kind = choice === "every" ? "every" : choice === "month" ? "monthDays" : "weekdays";
  const weekdays = choice === "workdays" ? WORKDAYS : state.days.weekdays;
  return { ...state, choice, days: { ...state.days, kind, weekdays } };
}

function CustomRules({
  state,
  errors,
  problems,
  locale,
  patch,
}: {
  state: Simple;
  errors: (RuleError | null)[];
  problems: ScheduleProblem[];
  locale: string;
  patch: Patch;
}) {
  const text = useTranslations("settings.integrations.scheduleControl");
  const update = (index: number, draft: Draft) =>
    patch((all) => ({ ...all, drafts: all.drafts.map((one, other) => (other === index ? draft : one)) }));
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {state.drafts.length === 0 && (
        <p className="rounded-ctl border border-dashed border-border bg-card p-3 text-sm text-muted">
          {text("manualHint")}
        </p>
      )}
      {state.drafts.map((draft, index) => (
        <RuleEditor
          key={index}
          number={index + 1}
          draft={draft}
          error={errors[index]}
          neverRuns={problems.some((one) => one.code === "neverRuns" && one.rule === index)}
          locale={locale}
          onChange={(next) => update(index, next)}
          onRemove={() =>
            patch((all) => ({ ...all, drafts: all.drafts.filter((_draft, other) => other !== index) }))
          }
        />
      ))}
      {state.drafts.length < MAX_RULES && (
        <div>
          <Button
            size="sm"
            icon={<Plus className="size-3.5" aria-hidden />}
            onClick={() => patch((all) => ({ ...all, drafts: [...all.drafts, blankDraft("times")] }))}
          >
            {text("addRule")}
          </Button>
        </div>
      )}
    </div>
  );
}

function ModeOption({
  mode,
  state,
  groupName,
  children,
  patch,
}: {
  mode: Mode;
  state: Simple;
  groupName: string;
  children: ReactNode;
  patch: Patch;
}) {
  const text = useTranslations("settings.integrations.scheduleControl");
  const chosen = state.mode === mode;
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-ctl border p-3",
        chosen ? "border-accent bg-sel" : "border-border",
      )}
    >
      <label className="flex min-h-6 cursor-pointer items-start gap-2">
        <input
          type="radio"
          name={groupName}
          value={mode}
          checked={chosen}
          onChange={() => patch((all) => chosenMode(all, mode))}
          className="focus-ring mt-px size-4 shrink-0 accent-primary"
        />
        <span className="flex flex-col">
          <span className="font-medium">{text(`modes.${mode}`)}</span>
          {mode !== "repeat" && <span className="text-sm text-muted">{text(`modes.${mode}Hint`)}</span>}
        </span>
      </label>
      {chosen && children}
    </div>
  );
}

export function SimpleDays({
  state,
  error,
  locale,
  patch,
}: {
  state: Simple;
  error: RuleError | null | undefined;
  locale: string;
  patch: Patch;
}) {
  const text = useTranslations("settings.integrations.scheduleControl");
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium" aria-hidden>
        {text("days.label")}
      </span>
      <Segmented
        label={text("days.label")}
        value={state.choice}
        onChange={(choice) => patch((all) => chosenDays(all, choice))}
        options={DAY_CHOICES.map((value) => ({ value, label: text(`days.choices.${value}`) }))}
      />
      {state.choice === "pick" && (
        <WeekdayChips
          label={text("days.weekdaysLabel")}
          locale={locale}
          weekdays={state.days.weekdays}
          onChange={(weekdays) => patch((all) => ({ ...all, days: { ...all.days, weekdays } }))}
        />
      )}
      {state.choice === "month" && (
        <MonthDayChips
          label={text("days.monthDaysLabel")}
          monthDays={state.days.monthDays}
          onChange={(monthDays) => patch((all) => ({ ...all, days: { ...all.days, monthDays } }))}
        />
      )}
      {error === "days" && (
        <p role="alert" className="text-sm text-neg">
          {text("errors.days")}
        </p>
      )}
    </div>
  );
}

/** The four modes, each with its own fields under it. */
export function Modes({
  state,
  errors,
  problems,
  locale,
  patch,
}: {
  state: Simple;
  errors: (RuleError | null)[];
  problems: ScheduleProblem[];
  locale: string;
  patch: Patch;
}) {
  const text = useTranslations("settings.integrations.scheduleControl");
  const groupName = useId();
  const body: Record<Mode, ReactNode> = {
    repeat: (
      <RepeatFields
        state={state}
        error={errors[0]}
        onChange={(change) => patch((all) => ({ ...all, ...change }))}
      />
    ),
    times: <TimesEditor times={state.times} onChange={(times) => patch((all) => ({ ...all, times }))} />,
    manual: null,
    custom: <CustomRules state={state} errors={errors} problems={problems} locale={locale} patch={patch} />,
  };
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="sr-only">{text("modes.label")}</legend>
      {MODES.map((mode) => (
        <ModeOption key={mode} mode={mode} state={state} groupName={groupName} patch={patch}>
          {body[mode]}
        </ModeOption>
      ))}
    </fieldset>
  );
}
