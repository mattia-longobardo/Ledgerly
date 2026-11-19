"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, type Ref, useId, useRef, useState, useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { Field } from "@ledgerly/ui/field";
import { Input } from "@ledgerly/ui/input";
import { Modal } from "@ledgerly/ui/modal";
import { notify } from "@ledgerly/ui/toast";
import {
  type ActionResult,
  deleteValuationAction,
  recordValuationAction,
  setFundStateAction,
  updateValuationAction,
  type ValuationFormInput,
} from "../actions";

/** The errors a form of Funds has a sentence for; any other reads as "not saved". */
const KNOWN_ERRORS: readonly string[] = [
  "invalid",
  "not_found",
  "duplicate_name",
  "archived",
  "linked",
  "future_date",
  "movement_taken",
];

/** The message key of an action's error. */
export const errorKey = (error: string) =>
  `errors.${KNOWN_ERRORS.includes(error) ? error : "failed"}` as "errors.failed";

/** What a form says after its action answered: nothing, or the sentence of the error. */
export function useResult() {
  const t = useTranslations("funds");
  const [error, setError] = useState<string | null>(null);
  return {
    error,
    setError,
    ok(result: ActionResult): boolean {
      if (result.ok) {
        setError(null);
        return true;
      }
      setError(t(errorKey(result.error)));
      return false;
    },
  };
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="col-span-full text-sm text-neg">
      {error}
    </p>
  ) : null;
}

/**
 * Where a valuation command sits, and so which button it is: the page header's call to action, a
 * card header beside the other command of that card, or a table row.
 */
type TriggerPlace = "page" | "card" | "row";

/** One trigger, so "Record valuation" carries the same weight wherever it is offered. */
function Trigger({
  place,
  label,
  onClick,
  ref,
}: {
  place: TriggerPlace;
  label: string;
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  if (place === "row")
    return (
      <Button ref={ref} size="xs" variant="ghost" onClick={onClick}>
        {label}
      </Button>
    );
  return (
    <Button ref={ref} variant={place === "page" ? "primary" : "secondary"} size="sm" onClick={onClick}>
      {label}
    </Button>
  );
}

export interface ValuationDraft extends ValuationFormInput {
  id: string;
}

/** The valuation fields, shared by "Record valuation" and "Edit" so the two agree. */
function ValuationFields({ id, today, draft }: { id: string; today: string; draft?: ValuationDraft }) {
  const t = useTranslations("funds.valuations.form");
  return (
    <>
      <Field label={t("date")} htmlFor={`${id}-on`}>
        <Input id={`${id}-on`} name="on" type="date" max={today} defaultValue={draft?.on ?? today} required />
      </Field>
      <Field label={t("value")} htmlFor={`${id}-value`}>
        <Input
          id={`${id}-value`}
          name="value"
          inputMode="decimal"
          numeric
          required
          autoFocus
          defaultValue={draft?.value ?? ""}
        />
      </Field>
      <Field label={t("note")} htmlFor={`${id}-note`}>
        <Input id={`${id}-note`} name="note" maxLength={200} defaultValue={draft?.note ?? ""} />
      </Field>
    </>
  );
}

function readValuation(data: FormData): ValuationFormInput {
  const text = (key: string) => String(data.get(key) ?? "").trim();
  return { on: text("on"), value: text("value"), note: text("note") };
}

/** "Record valuation" (design modal): the day, the value and a note. */
export function ValuationButton({
  fundId,
  fundName,
  today,
  lastLine,
  label,
  place = "page",
}: {
  fundId: string;
  fundName: string;
  today: string;
  lastLine: string | null;
  label: string;
  place?: TriggerPlace;
}) {
  const t = useTranslations("funds");
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { error, setError, ok } = useResult();
  const opener = useRef<HTMLButtonElement>(null);
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = readValuation(new FormData(event.currentTarget));
    startTransition(async () => {
      if (!ok(await recordValuationAction(fundId, input))) return;
      notify(t("toasts.valuation"));
      setOpen(false);
    });
  }
  return (
    <>
      <Trigger ref={opener} place={place} label={label} onClick={() => (setError(null), setOpen(true))} />
      <Modal
        open={open}
        onOpenChange={setOpen}
        finalFocus={opener}
        title={t("valuations.form.title", { name: fundName })}
        description={t("valuations.form.description")}
      >
        <form onSubmit={onSubmit} noValidate className="grid grid-cols-2 gap-3">
          <ValuationFields id={id} today={today} />
          {lastLine && <p className="col-span-full text-sm text-muted">{lastLine}</p>}
          <ErrorLine error={error} />
          <div className="col-span-full flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>{t("valuations.form.cancel")}</Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {t("valuations.form.save")}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/**
 * "Edit" on a valuation row: the same four fields, already filled. A new day moves the value to
 * that day (service `updateValuation`), it never leaves a second row behind.
 */
export function EditValuationButton({
  fundId,
  draft,
  today,
  label,
}: {
  fundId: string;
  draft: ValuationDraft;
  today: string;
  label: string;
}) {
  const t = useTranslations("funds");
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { error, setError, ok } = useResult();
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = readValuation(new FormData(event.currentTarget));
    startTransition(async () => {
      if (!ok(await updateValuationAction(fundId, draft.id, input))) return;
      notify(t("toasts.valuationUpdated"));
      setOpen(false);
    });
  }
  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => (setError(null), setOpen(true))}>
        {label}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={t("valuations.editTitle")}>
        <form onSubmit={onSubmit} noValidate className="grid grid-cols-2 gap-3">
          <ValuationFields id={id} today={today} draft={draft} />
          <ErrorLine error={error} />
          <div className="col-span-full flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>{t("valuations.form.cancel")}</Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {t("valuations.form.save")}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/** A small action that asks the server and says how it went. */
function ActionButton({
  label,
  run,
  toast,
  danger,
}: {
  label: string;
  run: () => Promise<ActionResult>;
  toast: string;
  danger?: boolean;
}) {
  const t = useTranslations("funds");
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="xs"
      variant={danger ? "danger" : "ghost"}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await run();
          notify(result.ok ? toast : t(errorKey(result.error)), result.ok ? "success" : "error");
        })
      }
    >
      {label}
    </Button>
  );
}

export function DeleteValuation({
  fundId,
  valuationId,
  label,
  toast,
}: {
  fundId: string;
  valuationId: string;
  label: string;
  toast: string;
}) {
  return (
    <ActionButton label={label} toast={toast} danger run={() => deleteValuationAction(fundId, valuationId)} />
  );
}

export function FundStateButton({
  fundId,
  state,
  label,
  toast,
}: {
  fundId: string;
  state: "active" | "archived";
  label: string;
  toast: string;
}) {
  return (
    <ActionButton
      label={label}
      toast={toast}
      danger={state === "archived"}
      run={() => setFundStateAction(fundId, state)}
    />
  );
}
