"use client";

import { MIN_SYNC_GAP_MINUTES } from "@ledgerly/api-contract/settings";
import { Trash2 } from "lucide-react";
import { useId } from "react";
import { useTranslations } from "use-intl";
import { IconButton } from "../button";
import { Field } from "../field";
import { Input, Select } from "../input";
import { DaysEditor } from "./days-editor";
import { blankDraftKeepingDays, type Draft, type RuleError, type Unit } from "./drafts";
import { TimeInput } from "./time-input";
import { TimesEditor } from "./times-editor";
import type { RuleKind } from "./types";

type IntervalDraft = Extract<Draft, { kind: "interval" }>;

const KINDS: readonly RuleKind[] = ["interval", "times", "cron"];
const isKind = (value: string): value is RuleKind => KINDS.some((kind) => kind === value);
const isUnit = (value: string): value is Unit => value === "minutes" || value === "hours";

function IntervalFields({
  draft,
  error,
  onChange,
}: {
  draft: IntervalDraft;
  error: RuleError | null;
  onChange: (draft: Draft) => void;
}) {
  const text = useTranslations("settings.integrations.scheduleControl");
  const id = useId();
  const badWindow = error === "window" || error === "time";
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label={text("every")} htmlFor={`${id}-every`}>
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
            aria-label={text("unit")}
            value={draft.unit}
            onChange={(event) =>
              isUnit(event.target.value) && onChange({ ...draft, unit: event.target.value })
            }
            className="w-auto"
          >
            <option value="minutes">{text("units.minutes")}</option>
            <option value="hours">{text("units.hours")}</option>
          </Select>
        </div>
      </Field>
      <Field label={text("from")} htmlFor={`${id}-from`}>
        <TimeInput
          id={`${id}-from`}
          value={draft.from}
          invalid={badWindow}
          onValue={(from) => onChange({ ...draft, from })}
        />
      </Field>
      <Field label={text("until")} htmlFor={`${id}-until`}>
        <TimeInput
          id={`${id}-until`}
          value={draft.until}
          invalid={badWindow}
          onValue={(until) => onChange({ ...draft, until })}
        />
      </Field>
    </div>
  );
}

function CronField({
  expression,
  invalid,
  onChange,
}: {
  expression: string;
  invalid: boolean;
  onChange: (expression: string) => void;
}) {
  const text = useTranslations("settings.integrations.scheduleControl");
  const id = useId();
  return (
    <Field label={text("cron")} htmlFor={`${id}-cron`} hint={text("cronHint")}>
      <Input
        id={`${id}-cron`}
        value={expression}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        invalid={invalid}
        onChange={(event) => onChange(event.target.value)}
        className="font-mono"
      />
    </Field>
  );
}

/** What is wrong with a rule, as the line under it says. */
function useRuleMessage(error: RuleError | null, refused: boolean): string | null {
  const text = useTranslations("settings.integrations.scheduleControl");
  if (error === "every") return text("errors.every", { minutes: MIN_SYNC_GAP_MINUTES });
  if (error) return text(`errors.${error}`);
  return refused ? text("errors.neverRuns") : null;
}

/** The title of a rule, the kind it is, and the button that removes it. */
function RuleHeader({
  number,
  draft,
  onChange,
  onRemove,
}: {
  number: number;
  draft: Draft;
  onChange: (draft: Draft) => void;
  onRemove: () => void;
}) {
  const text = useTranslations("settings.integrations.scheduleControl");
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium" aria-hidden>
        {text("rule", { n: number })}
      </span>
      <Select
        aria-label={text("kindLabel", { n: number })}
        value={draft.kind}
        onChange={(event) =>
          isKind(event.target.value) && onChange(blankDraftKeepingDays(draft, event.target.value))
        }
        className="w-auto min-w-0 flex-1 sm:flex-none"
      >
        {KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {text(`kinds.${kind}`)}
          </option>
        ))}
      </Select>
      <IconButton label={text("removeRule", { n: number })} onClick={onRemove} className="ml-auto">
        <Trash2 className="size-4" aria-hidden />
      </IconButton>
    </div>
  );
}

/** One rule under "Custom rules": its kind, its fields, its days and what is wrong with it. */
export function RuleEditor({
  number,
  draft,
  error,
  neverRuns,
  locale,
  onChange,
  onRemove,
}: {
  number: number;
  draft: Draft;
  error: RuleError | null;
  neverRuns: boolean;
  locale: string;
  onChange: (draft: Draft) => void;
  onRemove: () => void;
}) {
  const text = useTranslations("settings.integrations.scheduleControl");
  const message = useRuleMessage(error, neverRuns);
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 rounded-ctl border border-border bg-card p-3">
      <legend className="sr-only">{text("rule", { n: number })}</legend>
      <RuleHeader number={number} draft={draft} onChange={onChange} onRemove={onRemove} />
      {draft.kind === "interval" && <IntervalFields draft={draft} error={error} onChange={onChange} />}
      {draft.kind === "times" && (
        <TimesEditor
          number={number}
          times={draft.times}
          onChange={(times) => onChange({ ...draft, times })}
        />
      )}
      {draft.kind === "cron" && (
        <CronField
          expression={draft.expression}
          invalid={error === "cron"}
          onChange={(expression) => onChange({ ...draft, expression })}
        />
      )}
      {draft.kind !== "cron" && (
        <DaysEditor
          number={number}
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
