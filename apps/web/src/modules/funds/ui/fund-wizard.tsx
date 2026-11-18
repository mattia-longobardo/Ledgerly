"use client";

import type { Route } from "next";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState, useTransition } from "react";
import { createFundAction } from "@/app/(app)/funds/fund-setup";
import { parseAmount } from "@ledgerly/domain/platform/format";
import { type CivilDate, isCivilDate } from "@ledgerly/domain/shared/dates";
import {
  formatDate,
  formatMoney,
  type NumberFormat,
  numberSeparators,
  type UiLocale,
} from "@ledgerly/domain/platform/format";
import { DISPLAY_CURRENCIES } from "@ledgerly/domain/platform/fx/client";
import { Button, ButtonLink, LinkButton } from "@/ui/button";
import { Card } from "@/ui/card";
import { Field } from "@/ui/field";
import { Input, Select } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { StepIndicator } from "@/ui/step-indicator";
import { Switch } from "@/ui/switch";
import { notify } from "@/ui/toast";
import { useUnsavedForm } from "@/ui/unsaved-changes";
import {
  type FeeForm,
  type FundForm,
  newSourceForm,
  parseScope,
  type SourceForm,
  type WizardForm,
} from "@ledgerly/domain/funds/client";
import { SOURCE_KINDS, type SourceKind } from "@ledgerly/domain/funds/client";
import { applyTemplate, type FundTemplate } from "@ledgerly/domain/funds/client";
import { FeeManager } from "./fee-list";
import { feeAmountText, type FeeScopeOption } from "./fee-text";
import { sourceFieldId, SourceFields } from "./source-fields";
import {
  cleanSource,
  firstProblem,
  freeComponents,
  type SourceField,
  sourceErrors,
  sourceProblems,
  sourceSummary,
  type TakenComponents,
} from "./source-text";
import { FIELD_GRID } from "@/ui/section";

const WIZARD_STEPS = ["fund", "sources", "fees", "review"] as const;
type WizardStep = (typeof WIZARD_STEPS)[number];

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

type FundField = "name" | "startOn" | "value" | "valueOn";

/** What the four steps hold. A fee names a source by its kind here: its place is only known at the end. */
interface Draft {
  fund: FundForm;
  value: string;
  valueOn: string;
  currency: string;
  templateId: string;
  on: Record<SourceKind, boolean>;
  payroll: SourceForm;
  debit: SourceForm;
  fees: FeeForm[];
}

/** The rows of a template as the draft keeps them: `#<index>` becomes the kind of that source. */
function templateRows(template: FundTemplate | undefined, taken: TakenComponents, decimal: string) {
  const { sources, fees } = template ? applyTemplate(template, decimal) : { sources: [], fees: [] };
  const free = freeComponents(taken);
  const payroll = sources.find((source) => source.kind === "payroll");
  return {
    on: {
      payroll: payroll !== undefined,
      bank_debit: sources.some((source) => source.kind === "bank_debit"),
      manual: sources.some((source) => source.kind === "manual"),
    },
    payroll: payroll
      ? { ...payroll, components: payroll.components.filter((component) => free.includes(component)) }
      : { ...newSourceForm("payroll"), components: free },
    debit: sources.find((source) => source.kind === "bank_debit") ?? newSourceForm("bank_debit"),
    fees: fees.map((fee) => {
      const { key, component } = parseScope(fee.scope);
      const kind = key === null ? undefined : sources[Number(key.slice(1))]?.kind;
      return { ...fee, scope: kind === undefined ? "" : component === null ? kind : `${kind}:${component}` };
    }),
  };
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
  const tf = useTranslations("funds.fees");
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
  const [leaving, setLeaving] = useState<Route | null>(null);
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

  /** What is wrong in step 1, by field. */
  function fundProblems(): Partial<Record<FundField, string>> {
    const errors: Partial<Record<FundField, string>> = {};
    if (draft.fund.name.trim() === "") errors.name = t("errors.name");
    // A date half typed ("0002-03-01", the year's first digit) is no date yet.
    if (!isCivilDate(draft.fund.startOn)) errors.startOn = t("errors.memberSince");
    else if (draft.fund.startOn > todayOn) errors.startOn = t("errors.future");
    if (draft.value.trim() !== "") {
      try {
        if (parseAmount(draft.value, format) < 0n) errors.value = t("errors.value");
      } catch {
        errors.value = t("errors.value");
      }
      if (!isCivilDate(draft.valueOn)) errors.valueOn = t("errors.valueOn");
      else if (draft.valueOn > todayOn) errors.valueOn = t("errors.future");
      else if (draft.fund.startOn !== "" && draft.valueOn < draft.fund.startOn) {
        errors.valueOn = t("errors.valueBeforeStart");
      }
    }
    return errors;
  }

  const asked = WIZARD_STEPS.find((step) => step === params.get("step")) ?? "fund";
  // A step past the first is only reached with the first one filled in: an address that says
  // otherwise — a reload, a saved link — goes back to step 1.
  const fundReady = Object.keys(fundProblems()).length === 0;
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

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    // A link out of the procedure is asked about here, before Next.js sees the click. A link to
    // another step, a new tab or another site is left alone.
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      if ((link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      const to = new URL(link.href, window.location.href);
      if (to.origin !== window.location.origin || to.pathname === window.location.pathname) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaving(`${to.pathname}${to.search}${to.hash}` as Route);
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

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

  /** What "Applies to" offers: the sources switched on, and the components of the payslip one. */
  const scopes: FeeScopeOption[] = SOURCE_KINDS.filter(sourceOn).flatMap((kind) => [
    { value: kind, label: ts(`kinds.${kind}`) },
    ...(kind === "payroll"
      ? draft.payroll.components.map((component) => ({
          value: `payroll:${component}`,
          label: tf("scope.component", {
            source: ts("kinds.payroll"),
            component: ts(`components.${component}`),
          }),
        }))
      : []),
  ]);

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
    const errors = fundProblems();
    setFundErrors(errors);
    const first = (["name", "startOn", "value", "valueOn"] as const).find((field) => errors[field]);
    if (first === undefined) return true;
    go("fund", `${id}-${first}`);
    return false;
  }

  // ——— Create ——————————————————————————————————————————————————————————————————————————————

  /** The form as the action takes it: the sources switched on, a fee's source as `#<index>`. */
  function wizardForm(): WizardForm {
    const sources = [
      sourceOn("payroll") ? cleanSource(draft.payroll) : null,
      sourceOn("bank_debit") ? cleanSource(draft.debit) : null,
      sourceOn("manual") ? newSourceForm("manual") : null,
    ].filter((source) => source !== null);
    return {
      fund: draft.fund,
      value: draft.value,
      valueOn: draft.valueOn,
      currency: draft.currency,
      sources,
      fees: draft.fees.map((fee) => {
        const { key, component } = parseScope(fee.scope);
        const index = sources.findIndex((source) => source.kind === key);
        const scope = index === -1 ? "" : component === null ? `#${index}` : `#${index}:${component}`;
        return { ...fee, scope };
      }),
    };
  }

  function create() {
    setFailure(null);
    startTransition(async () => {
      const result = await createFundAction(wizardForm());
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

  const section = (name: WizardStep, intro: string | null, children: ReactNode, primary: string) => (
    <Card
      hidden={step !== name}
      data-testid={`wizard-step-${name}`}
      className={step === name ? "flex flex-col gap-4" : undefined}
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-heading-${name}`} tabIndex={-1} className="text-lg font-semibold outline-none">
          {t(`steps.${name}`)}
        </h2>
        {intro && <p className="text-muted">{intro}</p>}
      </div>
      {name !== "fund" && name !== "review" && template && (
        <p className="text-sm text-muted">{t("fromTemplate", { model: template.name })}</p>
      )}
      {children}
      {name === "review" && failure && (
        <p ref={alertRef} role="alert" tabIndex={-1} className="text-sm text-neg">
          {failure}
        </p>
      )}
      <div className="flex flex-col gap-2 border-t border-border pt-3 min-[480px]:flex-row-reverse min-[480px]:justify-between">
        <Button type="submit" variant="primary" disabled={pending}>
          {primary}
        </Button>
        {name === "fund" ? (
          <ButtonLink href={HOME} variant="ghost">
            {t("cancel")}
          </ButtonLink>
        ) : (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => go(WIZARD_STEPS[WIZARD_STEPS.indexOf(name) - 1])}
          >
            {t("back")}
          </Button>
        )}
      </div>
    </Card>
  );

  const sourceRow = (kind: SourceKind, question: string, help: string, fields: ReactNode) => (
    <div className="flex flex-col gap-3 border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span id={`${id}-${kind}-label`} className="font-medium">
            {question}
          </span>
          <span id={`${id}-${kind}-help`} className="text-sm text-muted">
            {help}
          </span>
        </div>
        <Switch
          checked={draft.on[kind]}
          onCheckedChange={(on) => toggle(kind, on)}
          labelledBy={`${id}-${kind}-label`}
          describedBy={`${id}-${kind}-help`}
          controls={fields === null ? undefined : `${id}-${kind}-fields`}
          data-testid={`source-switch-${kind}`}
        />
      </div>
      {fields !== null && <div id={`${id}-${kind}-fields`}>{draft.on[kind] && fields}</div>}
    </div>
  );

  const money = (text: string) => {
    try {
      return formatMoney(parseAmount(text, format), format, { currency: draft.currency });
    } catch {
      return text;
    }
  };
  const day = (on: string) => (isCivilDate(on) ? formatDate(on, "long", locale) : "");
  const accountName = accounts.find((account) => account.id === draft.debit.accountId)?.name ?? null;
  const summaryOptions = { format, locale, currency: draft.currency };

  const fundLines: [string, string][] = [
    [t("fund.name"), draft.fund.name.trim()],
    [t("fund.provider"), draft.fund.provider.trim()],
    [t("fund.line"), draft.fund.compartment.trim()],
    [t("fund.memberSince"), day(draft.fund.startOn)],
    [
      t("fund.value"),
      draft.value.trim() === ""
        ? ""
        : t("review.valueLine", { value: money(draft.value), date: day(draft.valueOn) }),
    ],
    [t("fund.currency"), draft.currency === currency ? "" : draft.currency],
    [t("fund.code"), draft.fund.code.trim()],
  ];
  const sourceLines = [
    sourceOn("payroll")
      ? `${ts("kinds.payroll")}: ${sourceSummary(ts, draft.payroll, summaryOptions)}`
      : null,
    sourceOn("bank_debit")
      ? `${ts("kinds.bank_debit")}: ${sourceSummary(ts, draft.debit, { ...summaryOptions, accountName })}`
      : null,
    sourceOn("manual") ? ts("kinds.manual") : null,
  ].filter((line) => line !== null);

  const group = (name: Exclude<WizardStep, "review">, title: string, lines: ReactNode) => (
    <div className="flex flex-col gap-1 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <dt className="flex items-center justify-between gap-3">
        <span className="font-medium">{title}</span>
        {/* A short word is narrower than a target may be: the button keeps 24 px of width. */}
        <LinkButton
          className="min-w-6 justify-center"
          aria-label={`${t("review.edit")}: ${title}`}
          onClick={() => go(name)}
        >
          {t("review.edit")}
        </LinkButton>
      </dt>
      <dd className="text-sm break-words">{lines}</dd>
    </div>
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
          <div className={FIELD_GRID}>
            <div className="col-span-full">
              <Field label={t("fund.name")} htmlFor={`${id}-name`} error={fundErrors.name}>
                <Input
                  id={`${id}-name`}
                  maxLength={80}
                  value={draft.fund.name}
                  onChange={(event) => setFund({ name: event.currentTarget.value })}
                />
              </Field>
            </div>
            <Field label={t("fund.provider")} htmlFor={`${id}-provider`}>
              <Input
                id={`${id}-provider`}
                maxLength={80}
                value={draft.fund.provider}
                onChange={(event) => setFund({ provider: event.currentTarget.value })}
              />
            </Field>
            <Field label={t("fund.line")} htmlFor={`${id}-compartment`}>
              <Input
                id={`${id}-compartment`}
                maxLength={80}
                value={draft.fund.compartment}
                onChange={(event) => setFund({ compartment: event.currentTarget.value })}
              />
            </Field>
            <Field label={t("fund.memberSince")} htmlFor={`${id}-startOn`} error={fundErrors.startOn}>
              <Input
                id={`${id}-startOn`}
                type="date"
                max={todayOn}
                value={draft.fund.startOn}
                onChange={(event) => setFund({ startOn: event.currentTarget.value })}
              />
            </Field>
            <Field label={t("fund.value")} htmlFor={`${id}-value`} error={fundErrors.value}>
              <Input
                id={`${id}-value`}
                numeric
                inputMode="decimal"
                value={draft.value}
                onChange={(event) => update({ value: event.currentTarget.value })}
              />
            </Field>
            {draft.value.trim() !== "" && (
              <Field label={t("fund.valueOn")} htmlFor={`${id}-valueOn`} error={fundErrors.valueOn}>
                <Input
                  id={`${id}-valueOn`}
                  type="date"
                  min={draft.fund.startOn || undefined}
                  max={todayOn}
                  value={draft.valueOn}
                  onChange={(event) => update({ valueOn: event.currentTarget.value })}
                />
              </Field>
            )}
            {templates.length > 0 && (
              <div className="flex flex-col gap-2 col-span-full">
                <Field label={t("fund.template")} htmlFor={`${id}-template`} hint={t("fund.templateHint")}>
                  <Select
                    id={`${id}-template`}
                    value={askTemplate ?? draft.templateId}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      if (touched) setAskTemplate(next);
                      else applyChosen(next);
                    }}
                  >
                    <option value="">{t("fund.templateNone")}</option>
                    {templates.map((one) => (
                      <option key={one.id} value={one.id}>
                        {one.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {askTemplate !== null && (
                  <div
                    role="group"
                    aria-label={t("fund.template")}
                    className="flex flex-wrap items-center gap-2 rounded-ctl border border-warn bg-warn-bg px-3 py-2 text-sm"
                  >
                    <p className="mr-auto">{t("fund.templateReplace")}</p>
                    <Button size="sm" onClick={() => setAskTemplate(null)}>
                      {t("fund.templateReplaceNo")}
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => applyChosen(askTemplate)}>
                      {t("fund.templateReplaceYes")}
                    </Button>
                  </div>
                )}
              </div>
            )}
            <details className="col-span-full">
              <summary className="focus-ring inline-flex min-h-6 cursor-default items-center rounded-[4px] text-sm font-medium text-muted">
                {t("fund.advanced")}
              </summary>
              <div className={`mt-2 ${FIELD_GRID}`}>
                <Field label={t("fund.currency")} htmlFor={`${id}-currency`} hint={t("fund.currencyFixed")}>
                  <Select
                    id={`${id}-currency`}
                    value={draft.currency}
                    onChange={(event) => update({ currency: event.currentTarget.value })}
                  >
                    {DISPLAY_CURRENCIES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("fund.code")} htmlFor={`${id}-code`} hint={t("fund.codeHint")}>
                  <Input
                    id={`${id}-code`}
                    maxLength={40}
                    value={draft.fund.code}
                    onChange={(event) => setFund({ code: event.currentTarget.value })}
                  />
                </Field>
              </div>
            </details>
          </div>,
          t("continue"),
        )}

        {section(
          "sources",
          t("sources.intro"),
          <div className="flex flex-col">
            {payrollAvailable ? (
              sourceRow(
                "payroll",
                t("sources.payrollQuestion"),
                t("sources.payrollHelp"),
                <SourceFields
                  form={draft.payroll}
                  onChange={(payroll) => choose({ payroll })}
                  accounts={accounts}
                  taken={taken}
                  payrollAvailable
                  errors={payrollErrors}
                  todayOn={todayOn}
                  locale={locale}
                  idPrefix={`${id}-payroll`}
                />,
              )
            ) : (
              <p className="pb-3 text-sm text-muted">{t("sources.payrollOff")}</p>
            )}
            {sourceRow(
              "bank_debit",
              t("sources.debitQuestion"),
              t("sources.debitHelp"),
              <SourceFields
                form={draft.debit}
                onChange={(debit) => choose({ debit })}
                accounts={accounts}
                taken={taken}
                payrollAvailable={payrollAvailable}
                errors={debitErrors}
                todayOn={todayOn}
                locale={locale}
                idPrefix={`${id}-debit`}
              />,
            )}
            {sourceRow("manual", t("sources.manualQuestion"), t("sources.manualHelp"), null)}
          </div>,
          t("continue"),
        )}

        {section(
          "fees",
          t("fees.intro"),
          <FeeManager
            fees={draft.fees}
            scopes={scopes}
            todayOn={todayOn}
            format={format}
            locale={locale}
            currency={draft.currency}
            onSave={(fee, index) => {
              choose({
                fees:
                  index === null
                    ? [...draft.fees, fee]
                    : draft.fees.map((one, at) => (at === index ? fee : one)),
              });
              return null;
            }}
            onRemove={(_fee, index) => choose({ fees: draft.fees.filter((_one, at) => at !== index) })}
            empty={(add) => (
              <>
                <p className="text-sm text-muted">{t("fees.empty")}</p>
                <div>{add}</div>
              </>
            )}
          />,
          draft.fees.length === 0 ? t("skip") : t("continue"),
        )}

        {section(
          "review",
          null,
          <dl className="flex flex-col gap-3">
            {group(
              "fund",
              t("review.fund"),
              <ul className="flex flex-col gap-0.5">
                {fundLines
                  .filter(([, value]) => value !== "")
                  .map(([label, value]) => (
                    <li key={label}>
                      <span className="text-muted">{label}:</span> {value}
                    </li>
                  ))}
              </ul>,
            )}
            {group(
              "sources",
              t("review.sources"),
              sourceLines.length === 0 ? (
                <p className="text-muted">{t("review.noSources")}</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {sourceLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ),
            )}
            {group(
              "fees",
              t("review.fees"),
              draft.fees.length === 0 ? (
                <p className="text-muted">{t("review.noFees")}</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {draft.fees.map((fee, index) => (
                    <li key={`${index}-${fee.label}`}>
                      {fee.label} · {feeAmountText(tf, fee, format, draft.currency)}
                    </li>
                  ))}
                </ul>
              ),
            )}
          </dl>,
          pending ? t("creating") : t("create"),
        )}
      </form>

      <Modal
        open={leaving !== null}
        onOpenChange={(open) => {
          if (!open) setLeaving(null);
        }}
        width={420}
        title={t("leave.title")}
        description={t("leave.text")}
        footer={
          <>
            <Button onClick={() => setLeaving(null)}>{t("leave.stay")}</Button>
            <Button
              variant="danger"
              onClick={() => {
                const to = leaving;
                setReleased(true);
                setLeaving(null);
                if (to !== null) router.push(to);
              }}
            >
              {t("leave.leave")}
            </Button>
          </>
        }
      >
        {null}
      </Modal>
    </>
  );
}
