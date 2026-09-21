"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState, useTransition } from "react";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input, Select, Textarea } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import { type ActionResult, deleteLeaveAction, saveAllowanceAction, saveLeaveAction } from "../actions";
import { LEAVE_DAY_KINDS, type LeaveDayKind } from "../rules";

/** A day as the edit dialog needs it back: the values the person would retype. */
export interface LeaveSummary {
  id: string;
  on: string;
  kind: LeaveDayKind;
  /** Half a day or a whole one, every kind alike (N0). */
  fraction: number;
  note: string | null;
  origin: "manual" | "trek";
}

/** The year's allowance as the dialog shows it, in the units a contract states. */
export interface AllowanceSummary {
  year: number;
  vacationDays: string;
  rolDays: string;
  /** Vacation and ROL together, in days, as the contract states it (N7). */
  totalDays: string;
  note: string;
}

const KNOWN_ERRORS = ["invalid", "invalid_input", "not_found", "not_bookable", "range_too_long"];

function useErrors() {
  const t = useTranslations("timeoff");
  const [error, setError] = useState<string | null>(null);
  return {
    error,
    clear: () => setError(null),
    report: (result: ActionResult): boolean => {
      if (result.ok) return true;
      // A refusal names its dates, which is the whole point of carrying them back from the
      // service: "16 June is a Saturday" beats "that date will not do".
      if (result.error === "not_bookable" && result.refused && result.refused.length > 0) {
        const first = result.refused[0];
        setError(t(`errors.${first.reason}` as "errors.weekend", { date: first.on }));
        return false;
      }
      setError(
        t(`errors.${KNOWN_ERRORS.includes(result.error) ? result.error : "failed"}` as "errors.failed"),
      );
      return false;
    },
  };
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-neg">
      {error}
    </p>
  ) : null;
}

/* Add or edit a day off (the design's "Add leave" modal) */

export function LeaveDialog({
  open,
  onOpenChange,
  day,
  today,
  date,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: LeaveSummary | null;
  today: string;
  /** The day the calendar was clicked on, when that is where this came from (M1). */
  date?: string;
}) {
  const t = useTranslations("timeoff");
  const router = useRouter();
  const id = useId();
  const [pending, start] = useTransition();
  const { error, clear, report } = useErrors();

  const [from, setFrom] = useState(day?.on ?? date ?? today);
  const [to, setTo] = useState("");
  const [kind, setKind] = useState<LeaveDayKind>(day?.kind ?? "vacation");
  const [fraction, setFraction] = useState(day?.fraction === 0.5 ? "0.5" : "1");
  const [note, setNote] = useState(day?.note ?? "");

  const editing = day !== null;

  function submit(event: FormEvent) {
    event.preventDefault();
    clear();
    start(async () => {
      const result = await saveLeaveAction({
        from,
        // Editing touches the one day the row stands for; only a new entry may span a range.
        to: editing ? "" : to,
        kind,
        fraction,
        note,
      });
      if (!report(result)) return;
      notify(t("toasts.saved"));
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? t("dialog.editTitle") : t("dialog.addTitle")}
      description={t("dialog.description")}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={pending}>
            {t("actions.cancel")}
          </Button>
          <Button variant="primary" onClick={submit} disabled={pending} form={`${id}-form`} type="submit">
            {t("actions.save")}
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t("dialog.kind")} htmlFor={`${id}-kind`}>
          <Select
            id={`${id}-kind`}
            value={kind}
            onChange={(event) => setKind(event.target.value as LeaveDayKind)}
          >
            {LEAVE_DAY_KINDS.map((one) => (
              <option key={one} value={one}>
                {t(`kinds.${one}` as "kinds.vacation")}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={editing ? t("dialog.date") : t("dialog.from")}
          htmlFor={`${id}-from`}
          hint={t("dialog.workingDaysOnly")}
        >
          <Input
            id={`${id}-from`}
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            required
          />
        </Field>

        {!editing && (
          <Field label={t("dialog.to")} htmlFor={`${id}-to`} hint={t("dialog.toHint")}>
            <Input id={`${id}-to`} type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </Field>
        )}

        {/* One control for every kind since N0: leave comes in halves and wholes, ROL included. */}
        <Field label={t("dialog.duration")} htmlFor={`${id}-fraction`}>
          <Select
            id={`${id}-fraction`}
            value={fraction}
            onChange={(event) => setFraction(event.target.value)}
          >
            <option value="1">{t("dialog.wholeDay")}</option>
            <option value="0.5">{t("dialog.halfDay")}</option>
          </Select>
        </Field>

        <Field label={t("dialog.note")} htmlFor={`${id}-note`} hint={noteHint(kind, t)}>
          <Textarea
            id={`${id}-note`}
            rows={2}
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>

        <ErrorLine error={error} />
      </form>
    </Modal>
  );
}

/**
 * What the note field says under itself, which depends on the kind: a half day's "morning" or
 * "afternoon" has nowhere else to live (plan F7 §3.6.5), and sickness and "other" do not go to
 * Trek and do not spend the vacation allowance (§3.6.7).
 */
function noteHint(kind: LeaveDayKind, t: ReturnType<typeof useTranslations<"timeoff">>): string {
  if (kind === "sick" || kind === "other") return t("dialog.localOnly");
  return t("dialog.noteHint");
}

/* The year's allowance */

export function AllowanceDialog({
  open,
  onOpenChange,
  allowance,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allowance: AllowanceSummary;
}) {
  const t = useTranslations("timeoff");
  const router = useRouter();
  const id = useId();
  const [pending, start] = useTransition();
  const { error, clear, report } = useErrors();

  const [vacationDays, setVacationDays] = useState(allowance.vacationDays);
  const [rolDays, setRolDays] = useState(allowance.rolDays);
  const [totalDays, setTotalDays] = useState(allowance.totalDays);
  const [note, setNote] = useState(allowance.note);

  function submit(event: FormEvent) {
    event.preventDefault();
    clear();
    start(async () => {
      const result = await saveAllowanceAction({
        year: String(allowance.year),
        vacationDays,
        rolDays,
        totalDays,
        note,
      });
      if (!report(result)) return;
      notify(t("toasts.allowanceSaved"));
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("allowance.title", { year: allowance.year })}
      description={t("allowance.description")}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={pending}>
            {t("actions.cancel")}
          </Button>
          <Button variant="primary" onClick={submit} disabled={pending} type="submit">
            {t("actions.save")}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t("allowance.vacationDays")} htmlFor={`${id}-vac`}>
          <Input
            id={`${id}-vac`}
            type="number"
            min="0"
            max="400"
            step="0.5"
            numeric
            value={vacationDays}
            onChange={(event) => setVacationDays(event.target.value)}
          />
        </Field>
        {/* Days, like vacation (N9): one unit on the whole screen, whatever the contract states. */}
        <Field label={t("allowance.rolDays")} htmlFor={`${id}-rol`} hint={t("allowance.rolHint")}>
          <Input
            id={`${id}-rol`}
            type="number"
            min="0"
            max="400"
            step="0.5"
            numeric
            value={rolDays}
            onChange={(event) => setRolDays(event.target.value)}
          />
        </Field>
        <Field label={t("allowance.totalDays")} htmlFor={`${id}-total`} hint={t("allowance.totalDaysHint")}>
          <Input
            id={`${id}-total`}
            type="number"
            min="0"
            max="400"
            step="0.5"
            numeric
            value={totalDays}
            onChange={(event) => setTotalDays(event.target.value)}
          />
        </Field>
        <Field label={t("dialog.note")} htmlFor={`${id}-note`}>
          <Input
            id={`${id}-note`}
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <ErrorLine error={error} />
      </form>
    </Modal>
  );
}

/* The buttons the page places */

/** "Add leave" — the topbar action and the empty state's. */
export function AddLeave({ today, label }: { today: string; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && <LeaveDialog open={open} onOpenChange={setOpen} day={null} today={today} />}
    </>
  );
}

/** The header's allowance button: "26 days · 32 h", which opens the year's allowance. */
export function EditAllowance({ allowance, label }: { allowance: AllowanceSummary; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && <AllowanceDialog open={open} onOpenChange={setOpen} allowance={allowance} />}
    </>
  );
}

/** One table row's Edit and Remove. */
export function RowActions({ day, today }: { day: LeaveSummary; today: string }) {
  const t = useTranslations("timeoff");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const { report } = useErrors();

  function remove() {
    if (!window.confirm(t("actions.confirmDelete", { date: day.on }))) return;
    start(async () => {
      const result = await deleteLeaveAction(day.id);
      if (!report(result)) {
        notify(t("errors.failed"), "error");
        return;
      }
      notify(t("toasts.removed"));
      router.refresh();
    });
  }

  return (
    <div className="flex justify-end gap-1.5">
      <Button size="xs" onClick={() => setOpen(true)} disabled={pending}>
        {t("actions.edit")}
      </Button>
      <Button size="xs" variant="danger" onClick={remove} disabled={pending}>
        {t("actions.remove")}
      </Button>
      {open && <LeaveDialog open={open} onOpenChange={setOpen} day={day} today={today} />}
    </div>
  );
}
