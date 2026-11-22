"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, type RefObject, useId, useState } from "react";
import type { NumberFormat } from "@ledgerly/format/format";
import { Button } from "@ledgerly/ui/button";
import { Field } from "@ledgerly/ui/field";
import { Input, InputGroup, Select } from "@ledgerly/ui/input";
import { Modal } from "@ledgerly/ui/modal";
import { Segmented } from "@ledgerly/ui/segmented";
import {
  FEE_BASES,
  FEE_PERIODS,
  type FeeBasis,
  feeModes,
  type FeePeriod,
  needsPeriod,
} from "@ledgerly/domain/shared/fees";
import type { FeeForm } from "@ledgerly/domain/funds/client";
import { cleanFee, feeModeOf, type FeeProblems, feeProblems, type FeeScopeOption } from "./fee-text";

interface FeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The fee the dialog starts from: a new one, or the one being edited (`id` set, or `editing`). */
  fee: FeeForm;
  /** True for "Edit fee": a fee of the form that creates a fund has no id to tell it by. */
  editing?: boolean;
  /** The choices of "Applies to" beside "Everything"; empty for a fund with no source. */
  scopes: readonly FeeScopeOption[];
  format: NumberFormat;
  /**
   * Keeps the fee. Answers `null` when it is kept — the dialog closes — or the message to show
   * over the buttons. The fields stay as they were written either way.
   */
  onSave: (fee: FeeForm) => Promise<string | null> | string | null;
  /** Where the focus goes on closing, for an opener the dialog cannot find by itself. */
  finalFocus?: RefObject<HTMLElement | null>;
}

/**
 * "Add fee" and "Edit fee" (screens §7.2): one dialog for the form that creates a fund, which keeps
 * the fee in its own state, and for Settings, which saves it. The fields follow the basis: a fee on
 * assets is a percentage with a period and no scope; joining and a request cost an amount.
 */
export function FeeDialog({ open, onOpenChange, fee, editing, ...rest }: FeeDialogProps) {
  const t = useTranslations("funds.fees");
  const formId = useId();
  const [pending, setPending] = useState(false);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      width={520}
      title={(editing ?? fee.id !== null) ? t("editTitle") : t("add")}
      finalFocus={rest.finalFocus}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button type="submit" form={formId} variant="primary" disabled={pending}>
            {t("save")}
          </Button>
        </>
      }
    >
      <FeeFields
        formId={formId}
        fee={fee}
        scopes={rest.scopes}
        format={rest.format}
        onPending={setPending}
        onSave={rest.onSave}
        onDone={() => onOpenChange(false)}
      />
    </Modal>
  );
}

/** The form itself. It mounts with the dialog, so each opening starts from the fee it was given. */
function FeeFields({
  formId,
  fee,
  scopes,
  format,
  onPending,
  onSave,
  onDone,
}: {
  formId: string;
  fee: FeeForm;
  scopes: readonly FeeScopeOption[];
  format: NumberFormat;
  onPending: (pending: boolean) => void;
  onSave: FeeDialogProps["onSave"];
  onDone: () => void;
}) {
  const t = useTranslations("funds.fees");
  const id = useId();
  const [draft, setDraft] = useState(fee);
  const [problems, setProblems] = useState<FeeProblems>({});
  const [failure, setFailure] = useState<string | null>(null);
  const set = (patch: Partial<FeeForm>) => setDraft((current) => ({ ...current, ...patch }));
  const modes = feeModes(draft.basis);
  const mode = feeModeOf(draft);
  const error = (field: keyof FeeProblems) =>
    problems[field] === undefined ? undefined : t(`errors.${problems[field]}`);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The dialog's form sits inside the page's own form in the procedure: only this one answers.
    event.stopPropagation();
    const found = feeProblems(draft, format);
    setProblems(found);
    setFailure(null);
    const first = (["label", "value", "validTo"] as const).find((field) => found[field] !== undefined);
    if (first !== undefined) {
      if (first === "validTo") document.getElementById(`${id}-advanced`)?.setAttribute("open", "");
      document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    onPending(true);
    try {
      const message = await onSave(cleanFee(draft));
      if (message === null) onDone();
      else setFailure(message);
    } finally {
      onPending(false);
    }
  }

  return (
    <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-3.5">
      <Field label={t("columns.label")} htmlFor={`${id}-label`} error={error("label")}>
        <Input
          id={`${id}-label`}
          maxLength={80}
          autoComplete="off"
          value={draft.label}
          onChange={(event) => set({ label: event.currentTarget.value })}
        />
      </Field>
      <Field label={t("columns.basis")} htmlFor={`${id}-basis`} hint={t(`basisHelp.${draft.basis}`)}>
        <Select
          id={`${id}-basis`}
          value={draft.basis}
          onChange={(event) => set({ basis: event.currentTarget.value as FeeBasis })}
        >
          {FEE_BASES.map((basis) => (
            <option key={basis} value={basis}>
              {t(`basis.${basis}`)}
            </option>
          ))}
        </Select>
      </Field>
      {modes.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t("mode.label")}</span>
          <Segmented
            label={t("mode.label")}
            value={mode}
            onChange={(next) => set({ mode: next })}
            options={modes.map((one) => ({ value: one, label: t(`mode.${one}`) }))}
          />
        </div>
      )}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Field
          label={t(mode === "rate" ? "valueRate" : "value")}
          htmlFor={`${id}-value`}
          error={error("value")}
        >
          {mode === "rate" ? (
            <InputGroup suffix="%">
              <Input
                id={`${id}-value`}
                numeric
                inputMode="decimal"
                autoComplete="off"
                value={draft.value}
                onChange={(event) => set({ value: event.currentTarget.value })}
              />
            </InputGroup>
          ) : (
            <Input
              id={`${id}-value`}
              numeric
              inputMode="decimal"
              autoComplete="off"
              value={draft.value}
              onChange={(event) => set({ value: event.currentTarget.value })}
            />
          )}
        </Field>
        {needsPeriod(draft.basis) && (
          <Field label={t("every")} htmlFor={`${id}-period`}>
            <Select
              id={`${id}-period`}
              value={draft.period}
              onChange={(event) => set({ period: event.currentTarget.value as FeePeriod })}
            >
              {FEE_PERIODS.map((period) => (
                <option key={period} value={period}>
                  {t(`periods.${period}`)}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      {scopes.length > 0 && draft.basis !== "on_assets" && (
        <Field label={t("columns.scope")} htmlFor={`${id}-scope`}>
          <Select
            id={`${id}-scope`}
            value={scopes.some((scope) => scope.value === draft.scope) ? draft.scope : ""}
            onChange={(event) => set({ scope: event.currentTarget.value })}
          >
            <option value="">{t("scope.all")}</option>
            {scopes.map((scope) => (
              <option key={scope.value} value={scope.value}>
                {scope.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <details
        id={`${id}-advanced`}
        open={fee.validFrom !== "" || fee.validTo !== "" || undefined}
        className="flex flex-col"
      >
        <summary className="focus-ring inline-flex min-h-6 cursor-default items-center rounded-sm text-sm font-medium text-muted">
          {t("advanced")}
        </summary>
        <div className="mt-2 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Field label={t("validFrom")} htmlFor={`${id}-validFrom`}>
            <Input
              id={`${id}-validFrom`}
              type="date"
              value={draft.validFrom}
              onChange={(event) => set({ validFrom: event.currentTarget.value })}
            />
          </Field>
          <Field label={t("validTo")} htmlFor={`${id}-validTo`} error={error("validTo")}>
            <Input
              id={`${id}-validTo`}
              type="date"
              min={draft.validFrom || undefined}
              value={draft.validTo}
              onChange={(event) => set({ validTo: event.currentTarget.value })}
            />
          </Field>
        </div>
      </details>
      <Field label={t("note")} htmlFor={`${id}-note`}>
        <Input
          id={`${id}-note`}
          maxLength={300}
          autoComplete="off"
          value={draft.note}
          onChange={(event) => set({ note: event.currentTarget.value })}
        />
      </Field>
      {failure && (
        <p role="alert" className="text-sm text-neg">
          {failure}
        </p>
      )}
    </form>
  );
}
