"use client";

// Step 2 of "Add pension fund" (screens §3): which sources feed the fund, each behind its switch.
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { CivilDate } from "@ledgerly/domain/shared/dates";
import type { UiLocale } from "@ledgerly/format/format";
import { SOURCE_KINDS, type SourceKind } from "@ledgerly/domain/funds/client";
import { Switch } from "@ledgerly/ui/switch";
import { SourceFields } from "./source-fields";
import type { SourceField, TakenComponents } from "./source-text";
import type { Draft } from "./wizard-draft";

interface SourcesStepProps {
  id: string;
  draft: Draft;
  accounts: readonly { id: string; name: string }[];
  taken: TakenComponents;
  payrollAvailable: boolean;
  payrollErrors: Partial<Record<SourceField, string>>;
  debitErrors: Partial<Record<SourceField, string>>;
  todayOn: CivilDate;
  locale: UiLocale;
  onToggle: (kind: SourceKind, on: boolean) => void;
  choose: (patch: Partial<Draft>) => void;
}

/** A source's question and switch, and its fields while it is on. */
function SourceRow({
  props,
  kind,
  question,
  help,
  fields,
}: {
  props: SourcesStepProps;
  kind: SourceKind;
  question: string;
  help: string;
  fields: ReactNode;
}) {
  const { id, draft } = props;
  return (
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
          onCheckedChange={(checked) => props.onToggle(kind, checked)}
          labelledBy={`${id}-${kind}-label`}
          describedBy={`${id}-${kind}-help`}
          controls={fields === null ? undefined : `${id}-${kind}-fields`}
          data-testid={`source-switch-${kind}`}
        />
      </div>
      {fields !== null && <div id={`${id}-${kind}-fields`}>{draft.on[kind] && fields}</div>}
    </div>
  );
}

/** The words of a source's question, by kind. */
const QUESTION = { payroll: "payroll", bank_debit: "debit", manual: "manual" } as const;

export function SourcesStep(props: SourcesStepProps) {
  const text = useTranslations("funds.wizard");
  const { id, draft, payrollAvailable, choose } = props;
  const fieldsOf = (key: "payroll" | "debit") => (
    <SourceFields
      accounts={props.accounts}
      taken={props.taken}
      todayOn={props.todayOn}
      locale={props.locale}
      form={draft[key]}
      onChange={(form) => choose(key === "payroll" ? { payroll: form } : { debit: form })}
      payrollAvailable={payrollAvailable}
      errors={key === "payroll" ? props.payrollErrors : props.debitErrors}
      idPrefix={`${id}-${key}`}
    />
  );
  return (
    <div className="flex flex-col">
      {SOURCE_KINDS.map((kind) =>
        kind === "payroll" && !payrollAvailable ? (
          <p key={kind} className="pb-3 text-sm text-muted">
            {text("sources.payrollOff")}
          </p>
        ) : (
          <SourceRow
            key={kind}
            props={props}
            kind={kind}
            question={text(`sources.${QUESTION[kind]}Question`)}
            help={text(`sources.${QUESTION[kind]}Help`)}
            fields={kind === "manual" ? null : fieldsOf(QUESTION[kind])}
          />
        ),
      )}
    </div>
  );
}
