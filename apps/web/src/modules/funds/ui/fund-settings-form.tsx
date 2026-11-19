"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { Field } from "@ledgerly/ui/field";
import { Input } from "@ledgerly/ui/input";
import { notify } from "@ledgerly/ui/toast";
import { updateFundAction } from "../actions";
import type { FundForm } from "@ledgerly/domain/funds/client";
import { ErrorLine, errorKey } from "./fund-forms";
import { FIELD_GRID } from "@ledgerly/ui/section";

/**
 * Settings › General (docs/design/rewrite-plan/ux/n6-pension-fund.md §6.1): one form for every fund.
 * The currency is the one of the account that holds the value: it was fixed when the fund was
 * created, so it is shown and never asked.
 */
export function FundSettingsForm({
  fundId,
  form,
  currency,
  today,
  readOnly = false,
}: {
  fundId: string;
  form: FundForm;
  currency: string;
  today: string;
  /** An archived fund does not change: its fields are shown, not offered. */
  readOnly?: boolean;
}) {
  const t = useTranslations("funds");
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: keyof FundForm) => String(data.get(key) ?? "").trim();
    startTransition(async () => {
      const result = await updateFundAction(fundId, {
        name: text("name"),
        provider: text("provider"),
        compartment: text("compartment"),
        startOn: text("startOn"),
        code: text("code"),
      });
      setDuplicate(!result.ok && result.error === "duplicate_name");
      setFailure(result.ok || result.error === "duplicate_name" ? null : t(errorKey(result.error)));
      if (result.ok) notify(t("toasts.saved"));
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <fieldset disabled={readOnly} className={`min-w-0 ${FIELD_GRID}`}>
        <legend className="sr-only">{t("settings.general.title")}</legend>
        <div className="col-span-full">
          <Field
            label={t("settings.general.name")}
            htmlFor={`${id}-name`}
            error={duplicate ? t("errors.duplicate_name") : undefined}
          >
            <Input
              id={`${id}-name`}
              name="name"
              required
              maxLength={80}
              autoComplete="off"
              defaultValue={form.name}
            />
          </Field>
        </div>
        <Field label={t("settings.general.provider")} htmlFor={`${id}-provider`}>
          <Input
            id={`${id}-provider`}
            name="provider"
            maxLength={80}
            autoComplete="off"
            defaultValue={form.provider}
          />
        </Field>
        <Field label={t("settings.general.compartment")} htmlFor={`${id}-compartment`}>
          <Input
            id={`${id}-compartment`}
            name="compartment"
            maxLength={80}
            autoComplete="off"
            defaultValue={form.compartment}
          />
        </Field>
        <Field label={t("settings.general.memberSince")} htmlFor={`${id}-start`}>
          <Input
            id={`${id}-start`}
            name="startOn"
            type="date"
            required
            max={today}
            defaultValue={form.startOn}
          />
        </Field>
        <details className="col-span-full">
          <summary className="focus-ring inline-flex min-h-6 cursor-pointer items-center rounded-sm text-sm font-medium text-muted hover:text-fg">
            {t("settings.general.advanced")}
          </summary>
          <div className={`pt-3 ${FIELD_GRID}`}>
            <Field
              label={t("settings.general.code")}
              htmlFor={`${id}-code`}
              hint={t("settings.general.codeHint")}
            >
              <Input
                id={`${id}-code`}
                name="code"
                maxLength={40}
                autoComplete="off"
                className="font-mono"
                defaultValue={form.code}
              />
            </Field>
            <Field
              label={t("settings.general.currency")}
              htmlFor={`${id}-currency`}
              hint={t("settings.general.currencyFixed")}
            >
              <Input id={`${id}-currency`} readOnly value={currency} />
            </Field>
          </div>
        </details>
        <ErrorLine error={failure} />
        {!readOnly && (
          <div className="col-span-full flex justify-end">
            <Button type="submit" variant="primary" disabled={pending}>
              {t("settings.save")}
            </Button>
          </div>
        )}
      </fieldset>
    </form>
  );
}
