"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type FormEvent, type RefObject, useId, useState, useTransition } from "react";
import { saveSourceAction } from "@/app/(app)/funds/fund-setup";
import type { CivilDate } from "@ledgerly/domain/platform/dates";
import { formatDate, formatMoney, type NumberFormat, type UiLocale } from "@ledgerly/domain/platform/format";
import { Button, LinkButton } from "@/ui/button";
import { Field } from "@/ui/field";
import { Select } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import { proposeDebitMatchAction } from "../actions";
import type { SourceForm } from "@ledgerly/domain/funds/client";
import { sourceFieldId, SourceFields } from "./source-fields";
import {
  cleanSource,
  firstProblem,
  type SourceField,
  sourceErrors,
  sourceProblems,
  type TakenComponents,
} from "./source-text";

/** What every source dialog of a fund needs beside the source itself. */
export interface SourceSetup {
  fundId: string;
  /** The open accounts a debit can be watched on. */
  accounts: readonly { id: string; name: string }[];
  /** The movements "Find from the movements" chooses from. */
  movements: readonly { id: string; label: string }[];
  /** The payslip components another fund holds already: component → that fund's name. */
  taken: TakenComponents;
  payrollAvailable: boolean;
  todayOn: CivilDate;
  format: NumberFormat;
  locale: UiLocale;
  /** The currency of the fund's amounts. */
  currency: string;
}

interface SourceDialogProps extends SourceSetup {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The source the dialog starts from: a new one (`id` is `null`) or the one being edited. */
  source: SourceForm;
  /** The explicit due dates a migrated source keeps, as text. */
  customDue?: string | null;
  /** Where the focus goes on closing: the menu's button, which the dialog cannot find by itself. */
  finalFocus?: RefObject<HTMLElement | null>;
}

/**
 * "Add source" and "Edit" in Settings › Contributions (screens §6.2): the fields of step 2, the note
 * of a payslip source, and for a debit the helper that reads what to match from a movement.
 */
export function SourceDialog({ open, onOpenChange, source, finalFocus, ...rest }: SourceDialogProps) {
  const t = useTranslations("funds.sources");
  const formId = useId();
  const [pending, setPending] = useState(false);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      width={520}
      title={t(`kinds.${source.kind}`)}
      description={t(source.id === null ? "dialog.add" : "dialog.edit")}
      finalFocus={finalFocus}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button type="submit" form={formId} variant="primary" disabled={pending}>
            {t("save")}
          </Button>
        </>
      }
    >
      <SourceDialogForm
        formId={formId}
        source={source}
        onPending={setPending}
        onDone={() => onOpenChange(false)}
        {...rest}
      />
    </Modal>
  );
}

/** The form itself. It mounts with the dialog, so each opening starts from the source it was given. */
function SourceDialogForm({
  formId,
  source,
  customDue,
  onPending,
  onDone,
  fundId,
  accounts,
  movements,
  taken,
  payrollAvailable,
  todayOn,
  format,
  locale,
  currency,
}: SourceSetup & {
  formId: string;
  source: SourceForm;
  customDue?: string | null;
  onPending: (pending: boolean) => void;
  onDone: () => void;
}) {
  const t = useTranslations("funds.sources");
  const router = useRouter();
  const id = useId();
  const [draft, setDraft] = useState(source);
  const [errors, setErrors] = useState<Partial<Record<SourceField, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problems = sourceProblems(draft, format);
    setErrors(sourceErrors(t, problems));
    setFailure(null);
    const first = firstProblem(problems);
    if (first !== null) {
      document.getElementById(sourceFieldId(id, first))?.focus();
      return;
    }
    onPending(true);
    try {
      const result = await saveSourceAction(fundId, cleanSource(draft));
      if (result.ok) {
        notify(t("saved"));
        onDone();
        router.refresh();
        return;
      }
      if (result.error === "component_taken") {
        setErrors({ components: t("errors.componentTaken", { fund: result.detail ?? "" }) });
        document.getElementById(sourceFieldId(id, "components"))?.focus();
      } else if (result.error === "archived") setFailure(t("errors.archived"));
      else if (result.error === "invalid_account") setFailure(t("errors.account"));
      // One active payslip source per fund.
      else if (result.error === "payroll_active") setFailure(t("errors.onePayroll"));
      else setFailure(t("errors.failed"));
    } finally {
      onPending(false);
    }
  }

  return (
    <form id={formId} onSubmit={submit} noValidate autoComplete="off" className="flex flex-col gap-3.5">
      <SourceFields
        form={draft}
        onChange={setDraft}
        accounts={accounts}
        taken={taken}
        payrollAvailable={payrollAvailable}
        errors={errors}
        todayOn={todayOn}
        locale={locale}
        showNote
        customDue={customDue}
        idPrefix={id}
        afterPayee={
          movements.length > 0 && (
            <DetectMatch
              fundId={fundId}
              accountId={draft.accountId}
              movements={movements}
              format={format}
              locale={locale}
              currency={currency}
              onUse={(text) => setDraft((current) => ({ ...current, payeeMatch: text.slice(0, 80) }))}
            />
          )
        }
      />
      {failure && (
        <p role="alert" className="text-sm text-neg">
          {failure}
        </p>
      )}
    </form>
  );
}

type Found = Extract<Awaited<ReturnType<typeof proposeDebitMatchAction>>, { ok: true }>["found"];

/**
 * "Find from the movements": pick one of the account's debits and the app reads what makes it
 * recognisable — the creditor identifier of the direct debit, its mandate reference, or its payee —
 * and says how many charges carry the same name. Nothing is saved: "Use this" writes the text into
 * "Payee contains", and the source is saved by its own button.
 */
function DetectMatch({
  fundId,
  accountId,
  movements,
  format,
  locale,
  currency,
  onUse,
}: {
  fundId: string;
  accountId: string;
  movements: readonly { id: string; label: string }[];
  format: NumberFormat;
  locale: UiLocale;
  currency: string;
  onUse: (text: string) => void;
}) {
  const t = useTranslations("funds.sources.detect");
  const id = useId();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState("");
  const [found, setFound] = useState<Found | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const day = (on: string | null) => (on === null ? "" : formatDate(on, "long", locale));

  function look(transactionId: string) {
    setChosen(transactionId);
    setFound(undefined);
    if (transactionId === "") return;
    startTransition(async () => {
      const result = await proposeDebitMatchAction(fundId, transactionId, accountId);
      if (!result.ok) {
        notify(t("failed"), "error");
        setChosen("");
        return;
      }
      setFound(result.found);
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <LinkButton aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen(!open)}>
        {t("button")}
      </LinkButton>
      <div id={`${id}-panel`} className="flex w-full flex-col gap-2">
        {open && (
          <>
            <Field label={t("movement")} htmlFor={`${id}-movement`}>
              <Select
                id={`${id}-movement`}
                value={chosen}
                disabled={pending}
                onChange={(event) => look(event.currentTarget.value)}
              >
                <option value="">{t("pick")}</option>
                {movements.map((movement) => (
                  <option key={movement.id} value={movement.id}>
                    {movement.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div aria-live="polite" className="flex flex-col items-start gap-2 text-sm">
              {chosen === "" ? null : found === undefined ? (
                <p className="text-muted">{t("looking")}</p>
              ) : found === null ? (
                <p className="text-muted">{t("nothing")}</p>
              ) : (
                <>
                  <dl className="flex w-full flex-col gap-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <dt className="text-muted">{t(`kinds.${found.kind}`)}</dt>
                      <dd className="font-medium break-all">{found.text}</dd>
                    </div>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <dt className="text-muted">{t("charges")}</dt>
                      <dd className="font-medium tabular-nums">
                        {found.first === null
                          ? found.count
                          : t("chargesValue", {
                              count: found.count,
                              from: day(found.first),
                              to: day(found.last),
                            })}
                      </dd>
                    </div>
                    {found.medianCents !== null && (
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <dt className="text-muted">{t("usual")}</dt>
                        <dd className="font-medium tabular-nums">
                          {formatMoney(BigInt(found.medianCents), format, { currency })}
                          {found.intervalDays !== null && ` · ${t("every", { days: found.intervalDays })}`}
                        </dd>
                      </div>
                    )}
                  </dl>
                  <Button
                    size="sm"
                    onClick={() => {
                      onUse(found.text);
                      setOpen(false);
                    }}
                  >
                    {t("use")}
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
