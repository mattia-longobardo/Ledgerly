"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useId } from "react";
import type { CivilDate } from "@ledgerly/domain/shared/dates";
import type { UiLocale } from "@ledgerly/domain/platform/format";
import { LinkButton } from "@ledgerly/ui/button";
import { Field } from "@ledgerly/ui/field";
import { Checkbox, Input, Select, Textarea } from "@ledgerly/ui/input";
import { Segmented } from "@ledgerly/ui/segmented";
import { Switch } from "@ledgerly/ui/switch";
import type { SourceForm } from "@ledgerly/domain/funds/client";
import {
  ACCRUAL_PERIODS,
  INTERVAL_UNITS,
  type IntervalUnit,
  nextDueDates,
  PAYROLL_COMPONENTS,
  type PayrollComponent,
} from "@ledgerly/domain/funds/client";
import { calendarOfForm, dueDatesText, type SourceField, type TakenComponents } from "./source-text";
import { FIELD_GRID } from "@ledgerly/ui/section";

export interface SourceFieldsProps {
  form: SourceForm;
  onChange: (form: SourceForm) => void;
  /** The open accounts a debit can be watched on. */
  accounts: readonly { id: string; name: string }[];
  /** The payslip components another fund holds already: component → that fund's name. */
  taken: TakenComponents;
  /** False without the Payroll module: a payslip source stays, with a note. */
  payrollAvailable: boolean;
  /** The messages under the fields, already in the reader's language. */
  errors: Partial<Record<SourceField, string>>;
  todayOn: CivilDate;
  locale: UiLocale;
  /** The "Note" field of a payslip source: in the source dialog only. */
  showNote?: boolean;
  /** The explicit due dates a migrated source keeps, as text ("20/4 · 20/7"). */
  customDue?: string | null;
  /** The start of every field's id: `<idPrefix>-<field>`. The caller focuses a field by it. */
  idPrefix: string;
  /** What follows "Payee contains" in a debit: the "Find from movements" helper of the dialog. */
  afterPayee?: ReactNode;
}

/** The id of a source's field, for the focus after a failed check. */
export const sourceFieldId = (idPrefix: string, field: SourceField): string => `${idPrefix}-${field}`;

/**
 * The fields of one source, by its kind (screens §3.3): the same in step 2 of the form that creates
 * a fund and in the source dialog of Settings. "Payments by hand" has no field.
 */
export function SourceFields(props: SourceFieldsProps) {
  if (props.form.kind === "payroll") return <PayrollFields {...props} />;
  if (props.form.kind === "bank_debit") return <DebitFields {...props} />;
  return null;
}

function PayrollFields({
  form,
  onChange,
  taken,
  payrollAvailable,
  errors,
  todayOn,
  locale,
  showNote,
  customDue,
  idPrefix,
}: SourceFieldsProps) {
  const t = useTranslations("funds.sources");
  const own = useId();
  const set = (patch: Partial<SourceForm>) => onChange({ ...form, ...patch });
  const id = (field: string) => `${idPrefix}-${field}`;
  const toggle = (component: PayrollComponent, on: boolean) =>
    set({
      components: PAYROLL_COMPONENTS.filter((one) =>
        one === component ? on : form.components.includes(one),
      ),
    });
  const dates = nextDueDates(form.accrualPeriod, calendarOfForm(form), todayOn);
  const keepsCustom = form.customDue && !form.hasDue;

  return (
    <div className="flex flex-col gap-3.5">
      {!payrollAvailable && <p className="text-sm text-muted">{t("payrollInactive")}</p>}
      <fieldset
        className="flex flex-col gap-1"
        aria-describedby={errors.components ? `${own}-components-error` : undefined}
      >
        <legend className="mb-1.5 text-sm font-medium">{t("components.label")}</legend>
        {PAYROLL_COMPONENTS.map((component, index) => {
          const holder = taken[component];
          return (
            <div key={component} className="flex flex-wrap items-center gap-x-2">
              <Checkbox
                id={index === 0 ? id("components") : undefined}
                label={t(`components.${component}`)}
                checked={form.components.includes(component)}
                disabled={holder !== undefined}
                aria-invalid={errors.components ? true : undefined}
                aria-describedby={holder !== undefined ? `${own}-taken-${component}` : undefined}
                onChange={(event) => toggle(component, event.currentTarget.checked)}
              />
              {holder !== undefined && (
                <span id={`${own}-taken-${component}`} className="text-sm text-muted">
                  {t("components.taken", { fund: holder })}
                </span>
              )}
            </div>
          );
        })}
        {errors.components && (
          <p id={`${own}-components-error`} className="text-sm text-neg">
            {errors.components}
          </p>
        )}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t("period.label")}</span>
        <Segmented
          label={t("period.label")}
          value={form.accrualPeriod}
          onChange={(accrualPeriod) => set({ accrualPeriod })}
          options={ACCRUAL_PERIODS.map((period) => ({ value: period, label: t(`period.${period}`) }))}
        />
      </div>

      <Field label={t("employer")} htmlFor={id("employer")}>
        <Input
          id={id("employer")}
          maxLength={120}
          autoComplete="off"
          value={form.employer}
          onChange={(event) => set({ employer: event.currentTarget.value })}
        />
      </Field>

      {keepsCustom ? (
        <div className="flex flex-col items-start gap-1">
          <p className="text-sm">{t("due.custom", { dates: customDue ?? "" })}</p>
          <LinkButton onClick={() => set({ hasDue: true })}>{t("due.replace")}</LinkButton>
        </div>
      ) : (
        <div className="flex min-h-11 items-center justify-between gap-3">
          <span id={`${own}-due-label`} className="text-sm font-medium">
            {t("due.switch")}
          </span>
          <Switch
            checked={form.hasDue}
            onCheckedChange={(hasDue) => set({ hasDue })}
            labelledBy={`${own}-due-label`}
            controls={`${own}-due`}
          />
        </div>
      )}

      <div id={`${own}-due`} className="flex flex-col gap-3.5">
        {form.hasDue && (
          <div className={FIELD_GRID}>
            <Field label={t("due.day")} htmlFor={id("dueDay")} error={errors.dueDay}>
              <Input
                id={id("dueDay")}
                type="number"
                inputMode="numeric"
                min={1}
                max={31}
                value={form.dueDay}
                onChange={(event) => set({ dueDay: event.currentTarget.value })}
              />
            </Field>
            <Field label={t("due.offset")} htmlFor={id("dueOffsetMonths")}>
              <Select
                id={id("dueOffsetMonths")}
                value={form.dueOffsetMonths}
                onChange={(event) => set({ dueOffsetMonths: event.currentTarget.value })}
              >
                {["0", "1", "2", "3"].map((months) => (
                  <option key={months} value={months}>
                    {months === "0" ? t("due.sameMonth") : months}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="col-span-full">
              <Field
                label={t("due.tolerance")}
                htmlFor={id("toleranceDays")}
                hint={t("due.toleranceHint")}
                error={errors.toleranceDays}
              >
                <Input
                  id={id("toleranceDays")}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={120}
                  value={form.toleranceDays}
                  onChange={(event) => set({ toleranceDays: event.currentTarget.value })}
                />
              </Field>
            </div>
          </div>
        )}
        {!keepsCustom && (
          <p aria-live="polite" className="text-sm text-muted" data-testid="due-preview">
            {dates.length > 0
              ? t("due.next", { dates: dueDatesText(dates, locale) })
              : form.hasDue
                ? ""
                : t("due.none")}
          </p>
        )}
      </div>

      {showNote && (
        <Field label={t("note")} htmlFor={id("note")}>
          <Textarea
            id={id("note")}
            maxLength={300}
            className="min-h-16"
            value={form.note}
            onChange={(event) => set({ note: event.currentTarget.value })}
          />
        </Field>
      )}
    </div>
  );
}

function DebitFields({ form, onChange, accounts, errors, idPrefix, afterPayee }: SourceFieldsProps) {
  const t = useTranslations("funds.sources");
  const set = (patch: Partial<SourceForm>) => onChange({ ...form, ...patch });
  const id = (field: string) => `${idPrefix}-${field}`;
  const count = /^\d+$/.test(form.frequencyCount.trim()) ? Number(form.frequencyCount) : 1;
  // An account the source names and the list no longer has (archived since): it stays an option.
  const unknownAccount = form.accountId !== "" && !accounts.some((account) => account.id === form.accountId);

  return (
    <div className={FIELD_GRID}>
      <Field label={t("debit.amount")} htmlFor={id("amount")} error={errors.amount}>
        <Input
          id={id("amount")}
          numeric
          inputMode="decimal"
          autoComplete="off"
          value={form.amount}
          onChange={(event) => set({ amount: event.currentTarget.value })}
        />
      </Field>
      <Field label={t("debit.frequency")} htmlFor={id("frequencyCount")} error={errors.frequencyCount}>
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-sm text-muted">
            {t("debit.every")}
          </span>
          <Input
            id={id("frequencyCount")}
            type="number"
            inputMode="numeric"
            min={1}
            max={120}
            className="w-16 shrink-0"
            value={form.frequencyCount}
            onChange={(event) => set({ frequencyCount: event.currentTarget.value })}
          />
          <Select
            aria-label={t("debit.unit")}
            className="min-w-0"
            value={form.frequencyUnit}
            onChange={(event) => set({ frequencyUnit: event.currentTarget.value as IntervalUnit })}
          >
            {INTERVAL_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {t(`debit.units.${unit}`, { count })}
              </option>
            ))}
          </Select>
        </div>
      </Field>
      {form.frequencyUnit !== "week" && (
        <Field label={t("debit.day")} htmlFor={id("debitDay")} error={errors.debitDay}>
          <Input
            id={id("debitDay")}
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            value={form.debitDay}
            onChange={(event) => set({ debitDay: event.currentTarget.value })}
          />
        </Field>
      )}
      <Field label={t("debit.account")} htmlFor={id("accountId")}>
        <Select
          id={id("accountId")}
          value={form.accountId}
          onChange={(event) => set({ accountId: event.currentTarget.value })}
        >
          <option value="">{t("debit.anyAccount")}</option>
          {unknownAccount && <option value={form.accountId}>{t("debit.otherAccount")}</option>}
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("debit.from")} htmlFor={id("validFrom")} hint={t("debit.fromHint")}>
        <Input
          id={id("validFrom")}
          type="date"
          value={form.validFrom}
          onChange={(event) => set({ validFrom: event.currentTarget.value })}
        />
      </Field>
      <Field label={t("debit.to")} htmlFor={id("validTo")} error={errors.validTo}>
        <Input
          id={id("validTo")}
          type="date"
          min={form.validFrom || undefined}
          value={form.validTo}
          onChange={(event) => set({ validTo: event.currentTarget.value })}
        />
      </Field>
      <div className="flex flex-col gap-1.5 col-span-full">
        <Field
          label={t("debit.match")}
          htmlFor={id("payeeMatch")}
          hint={t("debit.matchHint")}
          error={errors.payeeMatch}
        >
          <Input
            id={id("payeeMatch")}
            maxLength={80}
            autoComplete="off"
            value={form.payeeMatch}
            onChange={(event) => set({ payeeMatch: event.currentTarget.value })}
          />
        </Field>
        {afterPayee}
      </div>
    </div>
  );
}
