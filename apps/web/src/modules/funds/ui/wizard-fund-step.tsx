"use client";

// Step 1 of "Add pension fund" (screens §3): the fund, its value today, a template, and the
// currency and code under "Advanced".
import { useTranslations } from "next-intl";
import type { CivilDate } from "@ledgerly/domain/shared/dates";
import type { FundForm, FundTemplate } from "@ledgerly/domain/funds/client";
import { DISPLAY_CURRENCIES } from "@ledgerly/domain/platform/fx/client";
import { Button } from "@ledgerly/ui/button";
import { Field } from "@ledgerly/ui/field";
import { Input, Select } from "@ledgerly/ui/input";
import { FIELD_GRID } from "@ledgerly/ui/section";
import type { Draft, FundField } from "./wizard-draft";

interface FundStepProps {
  id: string;
  draft: Draft;
  errors: Partial<Record<FundField, string>>;
  todayOn: CivilDate;
  templates: readonly FundTemplate[];
  /** The template chosen while steps 2 and 3 hold choices: it waits for "Replace". */
  askTemplate: string | null;
  setFund: (patch: Partial<FundForm>) => void;
  update: (patch: Partial<Draft>) => void;
  onTemplate: (templateId: string) => void;
  onKeep: () => void;
  onApply: (templateId: string) => void;
}

/** A text field of the fund. */
function FundInput({
  props,
  field,
  maxLength,
}: {
  props: FundStepProps;
  field: "name" | "provider" | "compartment" | "code";
  maxLength: number;
}) {
  const { id, draft, setFund } = props;
  return (
    <Input
      id={`${id}-${field}`}
      maxLength={maxLength}
      value={draft.fund[field]}
      onChange={(event) => setFund({ [field]: event.currentTarget.value })}
    />
  );
}

/** The template, and the question before it replaces the sources and fees already chosen. */
function TemplateChoice(props: FundStepProps) {
  const text = useTranslations("funds.wizard");
  const { id, draft, templates, askTemplate } = props;
  return (
    <div className="flex flex-col gap-2 col-span-full">
      <Field label={text("fund.template")} htmlFor={`${id}-template`} hint={text("fund.templateHint")}>
        <Select
          id={`${id}-template`}
          value={askTemplate ?? draft.templateId}
          onChange={(event) => props.onTemplate(event.currentTarget.value)}
        >
          <option value="">{text("fund.templateNone")}</option>
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
          aria-label={text("fund.template")}
          className="flex flex-wrap items-center gap-2 rounded-ctl border border-warn bg-warn-bg px-3 py-2 text-sm"
        >
          <p className="mr-auto">{text("fund.templateReplace")}</p>
          <Button size="sm" onClick={props.onKeep}>
            {text("fund.templateReplaceNo")}
          </Button>
          <Button size="sm" variant="primary" onClick={() => props.onApply(askTemplate)}>
            {text("fund.templateReplaceYes")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** The currency, fixed once the fund exists, and the fund's code. */
function AdvancedFields(props: FundStepProps) {
  const text = useTranslations("funds.wizard");
  const { id, draft, update } = props;
  return (
    <details className="col-span-full">
      <summary className="focus-ring inline-flex min-h-6 cursor-default items-center rounded-sm text-sm font-medium text-muted">
        {text("fund.advanced")}
      </summary>
      <div className={`mt-2 ${FIELD_GRID}`}>
        <Field label={text("fund.currency")} htmlFor={`${id}-currency`} hint={text("fund.currencyFixed")}>
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
        <Field label={text("fund.code")} htmlFor={`${id}-code`} hint={text("fund.codeHint")}>
          <FundInput props={props} field="code" maxLength={40} />
        </Field>
      </div>
    </details>
  );
}

/** The value today and its date: the date only once a value is written. */
function ValueFields(props: FundStepProps) {
  const text = useTranslations("funds.wizard");
  const { id, draft, errors, todayOn, update } = props;
  return (
    <>
      <Field label={text("fund.value")} htmlFor={`${id}-value`} error={errors.value}>
        <Input
          id={`${id}-value`}
          numeric
          inputMode="decimal"
          value={draft.value}
          onChange={(event) => update({ value: event.currentTarget.value })}
        />
      </Field>
      {draft.value.trim() !== "" && (
        <Field label={text("fund.valueOn")} htmlFor={`${id}-valueOn`} error={errors.valueOn}>
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
    </>
  );
}

export function FundStep(props: FundStepProps) {
  const text = useTranslations("funds.wizard");
  const { id, draft, errors, todayOn, setFund } = props;
  return (
    <div className={FIELD_GRID}>
      <div className="col-span-full">
        <Field label={text("fund.name")} htmlFor={`${id}-name`} error={errors.name}>
          <FundInput props={props} field="name" maxLength={80} />
        </Field>
      </div>
      <Field label={text("fund.provider")} htmlFor={`${id}-provider`}>
        <FundInput props={props} field="provider" maxLength={80} />
      </Field>
      <Field label={text("fund.line")} htmlFor={`${id}-compartment`}>
        <FundInput props={props} field="compartment" maxLength={80} />
      </Field>
      <Field label={text("fund.memberSince")} htmlFor={`${id}-startOn`} error={errors.startOn}>
        <Input
          id={`${id}-startOn`}
          type="date"
          max={todayOn}
          value={draft.fund.startOn}
          onChange={(event) => setFund({ startOn: event.currentTarget.value })}
        />
      </Field>
      <ValueFields {...props} />
      {props.templates.length > 0 && <TemplateChoice {...props} />}
      <AdvancedFields {...props} />
    </div>
  );
}
