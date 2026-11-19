// The rules as the editor holds them while a person types: valid or not yet. The contract's schema
// says whether a draft is a rule; the server says whether the whole schedule runs as meant.
import { syncRuleSchema } from "@ledgerly/api-contract/settings";
import {
  dayChoice,
  type DayChoice,
  isWindowed,
  normalizeTime,
  type ScheduleForm,
  scheduleForm,
  WHOLE_DAY,
} from "./form";
import type { RuleKind, SyncDays, SyncRule, SyncSchedule } from "./types";

export type Unit = "minutes" | "hours";
export type DaysKind = SyncDays["kind"];

/** The days of a rule as edited: both lists are kept, so switching between them loses nothing. */
export interface DaysDraft {
  kind: DaysKind;
  weekdays: number[];
  monthDays: number[];
}

/** A rule as the form holds it: what the person typed, valid or not yet. */
export type Draft =
  | { kind: "interval"; every: string; unit: Unit; from: string; until: string; days: DaysDraft }
  | { kind: "times"; times: string[]; days: DaysDraft }
  | { kind: "cron"; expression: string };

/** Why a draft is not a rule: a key under `errors.*`. */
export type RuleError = "cron" | "days" | "times" | "every" | "time" | "window";

export const WORKDAYS = [1, 2, 3, 4, 5];

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

export function blankDraft(kind: RuleKind): Draft {
  if (kind === "cron") return { kind, expression: "0 7 * * 1-5" };
  if (kind === "times") return { kind, times: ["07:00"], days: daysDraft() };
  return { kind, every: "1", unit: "hours", from: "00:00", until: "23:59", days: daysDraft() };
}

/** A new kind of rule, keeping the days the person already picked. */
export function blankDraftKeepingDays(draft: Draft, kind: RuleKind): Draft {
  const next = blankDraft(kind);
  if (next.kind !== "cron" && draft.kind !== "cron") return { ...next, days: draft.days };
  return next;
}

function fromDays(days: DaysDraft): SyncDays {
  if (days.kind === "weekdays") return { kind: "weekdays", weekdays: days.weekdays };
  if (days.kind === "monthDays") return { kind: "monthDays", monthDays: days.monthDays };
  return { kind: "every" };
}

/** A draft as the rule it stands for — unchecked: the schema says whether it is one. */
export function fromDraft(draft: Draft): unknown {
  if (draft.kind === "cron") return { kind: "cron", expression: draft.expression };
  if (draft.kind === "times") return { kind: "times", times: draft.times, days: fromDays(draft.days) };
  const every = Number(draft.every);
  const minutes = draft.unit === "hours" ? every * 60 : every;
  return {
    kind: "interval",
    everyMinutes: draft.every.trim() === "" ? Number.NaN : minutes,
    from: draft.from,
    until: draft.until,
    days: fromDays(draft.days),
  };
}

/** Why one draft is not a rule; null when it is. */
export function ruleError(draft: Draft): RuleError | null {
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

export type Mode = ScheduleForm["mode"];
export const MODES: Mode[] = ["repeat", "times", "manual", "custom"];

/** What the simple modes hold. All of it is kept while the mode changes, so going back loses nothing. */
export interface Simple {
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

/** What "Repeat" holds: the saved rule when the schedule is one, else what the mode offers first. */
function repeatOf(form: ScheduleForm): Pick<Simple, "every" | "windowed" | "from" | "until"> {
  if (form.mode !== "repeat" || !isWindowed(form.from, form.until)) {
    return {
      every: form.mode === "repeat" ? form.everyMinutes : 60,
      windowed: false,
      from: "08:00",
      until: "19:00",
    };
  }
  return { every: form.everyMinutes, windowed: true, from: form.from, until: form.until };
}

export function simpleFrom(schedule: SyncSchedule): Simple {
  const form = scheduleForm(schedule);
  const days = form.mode === "repeat" || form.mode === "times" ? form.days : undefined;
  return {
    mode: form.mode,
    ...repeatOf(form),
    times: form.mode === "times" ? form.times : ["07:30", "22:30"],
    days: daysDraft(days),
    choice: days ? dayChoice(days) : "every",
    drafts: form.mode === "custom" ? form.rules.map(toDraft) : [],
  };
}

/** The rule drafts a state stands for: every check and the preview read these, in any mode. */
export function draftsOf(state: Simple): Draft[] {
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
