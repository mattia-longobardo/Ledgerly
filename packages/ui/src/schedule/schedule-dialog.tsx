"use client";

import { syncScheduleSchema } from "@ledgerly/api-contract";
import { useId, useState, useTransition } from "react";
import { useTranslations } from "use-intl";
import { Button } from "../button";
import { Modal } from "../modal";
import { Link } from "../router";
import { notify } from "../toast";
import { describeSchedule } from "./describe";
import {
  type Draft,
  draftsOf,
  fromDraft,
  type RuleError,
  ruleError,
  type Simple,
  simpleFrom,
} from "./drafts";
import { Modes, type Patch, SimpleDays } from "./modes";
import { PreviewPanel, type PreviewSchedule, usePreview } from "./preview";
import type { ScheduleProblem, SyncSchedule } from "./types";

/** Saves a schedule: the container says how (`{ ok: false }` is a schedule the server refused). */
export type SaveSchedule = (schedule: SyncSchedule) => Promise<{ ok: boolean }>;

/** A rule the server refused (`invalidRule`) is marked as the fields of its kind. */
function withServerErrors(drafts: Draft[], errors: (RuleError | null)[], problems: ScheduleProblem[]) {
  return errors.map((error, index) => {
    const refused = problems.some((one) => one.code === "invalidRule" && one.rule === index);
    if (error || !refused) return error;
    return drafts[index]?.kind === "cron" ? "cron" : "times";
  });
}

/** What the dialog is editing and how it stands: the rules, their errors, the server's answer. */
function useScheduleEdit(schedule: SyncSchedule, preview: PreviewSchedule) {
  const [state, setState] = useState<Simple>(() => simpleFrom(schedule));
  const drafts = draftsOf(state);
  const local = drafts.map(ruleError);
  const parsed = syncScheduleSchema.safeParse({ rules: drafts.map(fromDraft) });
  const valid = parsed.success && local.every((error) => error === null);
  const answer = usePreview(valid && parsed.success ? parsed.data : null, preview);
  const problems = answer?.problems ?? [];
  return {
    state,
    setState,
    drafts,
    errors: withServerErrors(drafts, local, problems),
    parsed: parsed.success ? parsed.data : null,
    valid,
    answer,
    problems,
    savable: valid && answer !== undefined && problems.length === 0,
  };
}

/** The coming passes, beside the fields they answer. */
function PreviewSection(props: Omit<Parameters<typeof PreviewPanel>[0], "headingId">) {
  const text = useTranslations("settings.integrations.scheduleControl");
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-1.5 rounded-ctl bg-hover p-3 sm:sticky sm:top-0"
    >
      <h3 id={headingId} className="text-sm font-medium">
        {text("preview.title")}
      </h3>
      <div aria-live="polite">
        <PreviewPanel headingId={headingId} {...props} />
      </div>
    </section>
  );
}

/** "Use recommended": this connection's default, said in a line. */
function Recommended({
  recommended,
  locale,
  disabled,
  onUse,
}: {
  recommended: SyncSchedule;
  locale: string;
  disabled: boolean;
  onUse: () => void;
}) {
  const text = useTranslations("settings.integrations.scheduleControl");
  return (
    <div>
      <Button size="xs" variant="ghost" disabled={disabled} onClick={onUse}>
        {text("useRecommended", { schedule: describeSchedule(recommended, text, locale) })}
      </Button>
    </div>
  );
}

/** Saves the schedule chosen, and says when the server refuses it. */
function useSaving(save: SaveSchedule, onClose: () => void) {
  const text = useTranslations("settings.integrations.scheduleControl");
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function onSave(chosen: SyncSchedule | null) {
    if (!chosen) return;
    startTransition(async () => {
      const result = await save(chosen);
      if (!result.ok) return setServerError(text("invalid"));
      setServerError(null);
      onClose();
      notify(text("saved"));
    });
  }
  return { serverError, setServerError, pending, onSave };
}

function Description({ timeZone }: { timeZone: string }) {
  const text = useTranslations("settings.integrations.scheduleControl");
  return text.rich("description", {
    timeZone,
    link: (chunks) => (
      <Link href="/settings/profile" className="focus-ring rounded-sm text-accent underline">
        {chunks}
      </Link>
    ),
  });
}

function Buttons({
  pending,
  savable,
  onCancel,
  onSave,
}: {
  pending: boolean;
  savable: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const text = useTranslations("settings.integrations.scheduleControl");
  return (
    <>
      <Button size="sm" onClick={onCancel} disabled={pending}>
        {text("cancel")}
      </Button>
      <Button size="sm" variant="primary" onClick={onSave} disabled={pending || !savable}>
        {text("save")}
      </Button>
    </>
  );
}

/** The fields of the dialog: what the server refused, the modes, the days, the recommended schedule. */
function Fields({
  edit,
  locale,
  recommended,
  serverError,
  pending,
  onRecommended,
}: {
  edit: ReturnType<typeof useScheduleEdit>;
  locale: string;
  recommended: SyncSchedule;
  serverError: string | null;
  pending: boolean;
  onRecommended: () => void;
}) {
  const patch: Patch = (change) => edit.setState(change);
  const simple = edit.state.mode === "repeat" || edit.state.mode === "times";
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {serverError && (
        <p role="alert" className="text-sm text-neg">
          {serverError}
        </p>
      )}
      <Modes state={edit.state} errors={edit.errors} problems={edit.problems} locale={locale} patch={patch} />
      {simple && <SimpleDays state={edit.state} error={edit.errors[0]} locale={locale} patch={patch} />}
      <Recommended
        recommended={recommended}
        locale={locale}
        disabled={pending}
        onUse={() => {
          edit.setState(simpleFrom(recommended));
          onRecommended();
        }}
      />
    </div>
  );
}

export function ScheduleDialog({
  name,
  schedule,
  recommended,
  timeZone,
  locale,
  save,
  preview,
  onClose,
}: {
  name: string;
  schedule: SyncSchedule;
  recommended: SyncSchedule;
  timeZone: string;
  locale: string;
  save: SaveSchedule;
  preview: PreviewSchedule;
  onClose: () => void;
}) {
  const text = useTranslations("settings.integrations.scheduleControl");
  const edit = useScheduleEdit(schedule, preview);
  const saving = useSaving(save, onClose);
  return (
    <Modal
      open
      onOpenChange={(value) => !value && onClose()}
      title={text("titleFor", { name })}
      description={<Description timeZone={timeZone} />}
      width={680}
      footer={
        <Buttons
          pending={saving.pending}
          savable={edit.savable}
          onCancel={onClose}
          onSave={() => saving.onSave(edit.parsed)}
        />
      }
    >
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
        <Fields
          edit={edit}
          locale={locale}
          recommended={recommended}
          serverError={saving.serverError}
          pending={saving.pending}
          onRecommended={() => saving.setServerError(null)}
        />
        <PreviewSection
          manual={edit.drafts.length === 0}
          valid={edit.valid}
          answer={edit.answer}
          timeZone={timeZone}
          locale={locale}
        />
      </div>
    </Modal>
  );
}
