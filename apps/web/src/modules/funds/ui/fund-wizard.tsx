"use client";

import type { Route } from "next";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState, useTransition } from "react";
import { createFundAction } from "../calls";
import { type CivilDate } from "@ledgerly/domain/shared/dates";
import { type NumberFormat, numberSeparators, type UiLocale } from "@ledgerly/domain/platform/format";
import { StepIndicator } from "@ledgerly/ui/step-indicator";
import { notify } from "@ledgerly/ui/toast";
import { useUnsavedForm } from "@ledgerly/ui/unsaved-changes";
import { type FundForm, type FundTemplate, type SourceKind } from "@ledgerly/domain/funds/client";
import { sourceFieldId } from "./source-fields";
import {
  firstProblem,
  type SourceField,
  sourceErrors,
  sourceProblems,
  type TakenComponents,
} from "./source-text";
import {
  type Draft,
  type FundField,
  fundProblems,
  templateRows,
  WIZARD_STEPS,
  type WizardStep,
  wizardFormOf,
} from "./wizard-draft";
import { FeesStep } from "./wizard-fees";
import { FundStep } from "./wizard-fund-step";
import { WizardReview } from "./wizard-review";
import { LeaveDialog, useLeaveGuard } from "./wizard-leave";
import { WizardSection } from "./wizard-section";
import { SourcesStep } from "./wizard-sources";

const HOME = "/funds" as Route;
const stepHref = (step: WizardStep) => `/funds/new?step=${step}` as Route;

export interface FundWizardProps {
  /** The open accounts a recurring debit can be watched on. */
  accounts: readonly { id: string; name: string }[];
  /** The payslip components another fund holds already: component → that fund's name. */
  taken: TakenComponents;
  /** False without the Payroll module: the payslip question is replaced by a note. */
  payrollAvailable: boolean;
  todayOn: CivilDate;
  /** The user's display currency: the default of "Currency". */
  currency: string;
  /** The fund templates; with none, the "Template" field is not there. */
  templates: readonly FundTemplate[];
  format: NumberFormat;
  locale: UiLocale;
}

/**
 * "Add pension fund" (screens §3): four steps of one form, the step in the address, nothing written
 * before "Create fund". Only the first step is required: a fund may start with no source and no fee.
 */
export function FundWizard({
  accounts,
  taken,
  payrollAvailable,
  todayOn,
  currency,
  templates,
  format,
  locale,
}: FundWizardProps) {
  const t = useTranslations("funds.wizard");
  const ts = useTranslations("funds.sources");
  const router = useRouter();
  const params = useSearchParams();
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft>(() => ({
    fund: { name: "", provider: "", compartment: "", startOn: "", code: "" },
    value: "",
    valueOn: todayOn,
    currency,
    templateId: "",
    ...templateRows(undefined, taken, "."),
  }));
  /** True once steps 2 or 3 hold a choice of the person's: a template then asks before replacing it. */
  const [touched, setTouched] = useState(false);
  const [askTemplate, setAskTemplate] = useState<string | null>(null);
  const [fundErrors, setFundErrors] = useState<Partial<Record<FundField, string>>>({});
  const [payrollErrors, setPayrollErrors] = useState<Partial<Record<SourceField, string>>>({});
  const [debitErrors, setDebitErrors] = useState<Partial<Record<SourceField, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  /** True once the page may be left without asking: the fund is created, or the person chose to leave. */
  const [released, setReleased] = useState(false);
  const unsaved = useUnsavedForm(formRef, pending);
  const dirty = !released && (unsaved.dirty || draft.fees.length > 0);

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const setFund = (patch: Partial<FundForm>) =>
    setDraft((current) => ({ ...current, fund: { ...current.fund, ...patch } }));
  const choose = (patch: Partial<Draft>) => {
    setTouched(true);
    update(patch);
  };

  // ——— The step ————————————————————————————————————————————————————————————————————————————

  /** What is wrong in step 1, by field, in words. */
  function fundErrorsOf(): Partial<Record<FundField, string>> {
    const problems = fundProblems(draft, todayOn, format);
    return Object.fromEntries(
      Object.entries(problems).map(([field, problem]) => [field, t(`errors.${problem}`)]),
    );
  }

  const asked = WIZARD_STEPS.find((step) => step === params.get("step")) ?? "fund";
  // A step past the first is only reached with the first one filled in: an address that says
  // otherwise — a reload, a saved link — goes back to step 1.
  const fundReady = Object.keys(fundProblems(draft, todayOn, format)).length === 0;
  const step: WizardStep = asked === "fund" || fundReady ? asked : "fund";
  useEffect(() => {
    if (asked !== step) router.replace(stepHref(step));
  }, [asked, step, router]);

  /** After a step changes the focus goes to its heading, or to the field a message sits under. */
  const focusNext = useRef<{ step: WizardStep; field: string } | null>(null);
  const shown = useRef(step);
  useEffect(() => {
    const target = focusNext.current;
    // A field of another step waits for that step: it cannot take the focus while it is hidden.
    if (target !== null && target.step === step) {
      focusNext.current = null;
      document.getElementById(target.field)?.focus();
    } else if (target === null && shown.current !== step) {
      document.getElementById(`${id}-heading-${step}`)?.focus();
    }
    shown.current = step;
  }, [step, id, fundErrors, payrollErrors, debitErrors]);

  function go(next: WizardStep, field: string | null = null) {
    focusNext.current = field === null ? null : { step: next, field };
    if (next !== step) router.push(stepHref(next));
  }

  // ——— Leaving with something written ———————————————————————————————————————————————————————

  useLeaveGuard(dirty, setLeaving);

  // ——— Templates ———————————————————————————————————————————————————————————————————————————

  const template = templates.find((one) => one.id === draft.templateId);

  function applyChosen(templateId: string) {
    update({
      templateId,
      ...templateRows(
        templates.find((one) => one.id === templateId),
        taken,
        numberSeparators(format).decimal,
      ),
    });
    setTouched(false);
    setAskTemplate(null);
    setPayrollErrors({});
    setDebitErrors({});
  }

  // ——— Sources and fees ————————————————————————————————————————————————————————————————————

  const sourceOn = (kind: SourceKind) => draft.on[kind] && (kind !== "payroll" || payrollAvailable);

  function toggle(kind: SourceKind, on: boolean) {
    const patch: Partial<Draft> = { on: { ...draft.on, [kind]: on } };
    // "Payee contains" starts from the provider written in step 1.
    if (kind === "bank_debit" && on && draft.debit.payeeMatch.trim() === "") {
      patch.debit = { ...draft.debit, payeeMatch: draft.fund.provider.trim().slice(0, 80) };
    }
    choose(patch);
  }

  /** Checks step 2; with something wrong the messages show and the first field takes the focus. */
  function sourcesReady(): boolean {
    const payroll = sourceOn("payroll") ? sourceProblems(draft.payroll, format) : {};
    const debit = sourceOn("bank_debit") ? sourceProblems(draft.debit, format) : {};
    setPayrollErrors(sourceErrors(ts, payroll));
    setDebitErrors(sourceErrors(ts, debit));
    const inPayroll = firstProblem(payroll);
    const inDebit = firstProblem(debit);
    if (inPayroll === null && inDebit === null) return true;
    go(
      "sources",
      inPayroll !== null ? sourceFieldId(`${id}-payroll`, inPayroll) : sourceFieldId(`${id}-debit`, inDebit!),
    );
    return false;
  }

  function fundStepReady(): boolean {
    const errors = fundErrorsOf();
    setFundErrors(errors);
    const first = (["name", "startOn", "value", "valueOn"] as const).find((field) => errors[field]);
    if (first === undefined) return true;
    go("fund", `${id}-${first}`);
    return false;
  }

  // ——— Create ——————————————————————————————————————————————————————————————————————————————

  function create() {
    setFailure(null);
    startTransition(async () => {
      const result = await createFundAction(wizardFormOf(draft, sourceOn));
      if (result.ok && result.id) {
        setReleased(true);
        unsaved.saved();
        notify(t("created"));
        router.push(`/funds/${result.id}` as Route);
        return;
      }
      const error = result.ok ? "failed" : result.error;
      if (error === "duplicate_name") {
        setFundErrors({ name: t("errors.duplicate") });
        go("fund", `${id}-name`);
      } else if (error === "future_date") {
        setFundErrors({ startOn: t("errors.future") });
        go("fund", `${id}-startOn`);
      } else if (error === "before_start") {
        setFundErrors({ valueOn: t("errors.valueBeforeStart") });
        go("fund", `${id}-valueOn`);
      } else if (error === "component_taken") {
        const fund = (result.ok ? null : result.detail) ?? "";
        setPayrollErrors({ components: ts("errors.componentTaken", { fund }) });
        go("sources", sourceFieldId(`${id}-payroll`, "components"));
      } else {
        setFailure(t("errors.failed"));
        requestAnimationFrame(() => alertRef.current?.focus());
      }
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (step === "fund") {
      if (fundStepReady()) go("sources");
    } else if (step === "sources") {
      if (sourcesReady()) go("fees");
    } else if (step === "fees") {
      go("review");
    } else if (fundStepReady() && sourcesReady()) {
      create();
    }
  }

  // ——— The pieces ——————————————————————————————————————————————————————————————————————————

  /** What the steps share. */
  const shared = { id, draft, todayOn, format, locale, accounts, taken, payrollAvailable, choose, sourceOn };

  const section = (name: WizardStep, intro: string | null, children: ReactNode, primary: string) => (
    <WizardSection
      name={name}
      step={step}
      id={id}
      intro={intro}
      templateName={template?.name ?? null}
      failure={failure}
      alertRef={alertRef}
      pending={pending}
      primary={primary}
      home={HOME}
      onBack={() => go(WIZARD_STEPS[WIZARD_STEPS.indexOf(name) - 1])}
    >
      {children}
    </WizardSection>
  );

  return (
    <>
      <form
        ref={formRef}
        onSubmit={submit}
        noValidate
        autoComplete="off"
        data-testid="fund-wizard"
        className="flex w-full flex-col gap-4"
      >
        <StepIndicator
          label={t("steps.label")}
          doneLabel={t("steps.done")}
          current={step}
          steps={WIZARD_STEPS.map((name) => ({ id: name, label: t(`steps.${name}`), href: stepHref(name) }))}
        />

        {section(
          "fund",
          t("fund.intro"),
          <FundStep
            {...shared}
            errors={fundErrors}
            templates={templates}
            askTemplate={askTemplate}
            setFund={setFund}
            update={update}
            onTemplate={(next) => {
              if (touched) setAskTemplate(next);
              else applyChosen(next);
            }}
            onKeep={() => setAskTemplate(null)}
            onApply={applyChosen}
          />,
          t("continue"),
        )}

        {section(
          "sources",
          t("sources.intro"),
          <SourcesStep
            {...shared}
            payrollErrors={payrollErrors}
            debitErrors={debitErrors}
            onToggle={toggle}
          />,
          t("continue"),
        )}

        {section(
          "fees",
          t("fees.intro"),
          <FeesStep {...shared} />,
          draft.fees.length === 0 ? t("skip") : t("continue"),
        )}

        {section(
          "review",
          null,
          <WizardReview {...shared} currency={currency} onEdit={go} />,
          pending ? t("creating") : t("create"),
        )}
      </form>

      <LeaveDialog
        open={leaving !== null}
        onStay={() => setLeaving(null)}
        onLeave={() => {
          const to = leaving;
          setReleased(true);
          setLeaving(null);
          if (to !== null) router.push(to as Route);
        }}
      />
    </>
  );
}
