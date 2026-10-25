"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, Chip } from "@/ui/button";
import { CardFooter } from "@/ui/card";
import { Field } from "@/ui/field";
import { Checkbox, Input } from "@/ui/input";
import { notify } from "@/ui/toast";
import { saveBudgetAlertsAction } from "../actions";
import { ALERT_PRESETS, type AlertSettings, type BudgetScope, MAX_ALERT_THRESHOLDS } from "../rules";

/**
 * When a budget emails (spec §7.3): a switch, the preset thresholds as chips, and any other whole
 * percentage typed in. Nothing is saved until "Save alerts", so a half-chosen set never mails.
 */
export function AlertsForm({
  scope,
  initial,
  percentLabels,
}: {
  scope: BudgetScope;
  initial: AlertSettings;
  /** Every percentage the form may show, formatted by the server in the user's number format. */
  percentLabels: Record<number, string>;
}) {
  const t = useTranslations("budgets.alerts");
  const errors = useTranslations("budgets.errors");
  const [enabled, setEnabled] = useState(initial.enabled);
  const [thresholds, setThresholds] = useState<number[]>(initial.thresholds);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const shown = [...new Set([...ALERT_PRESETS, ...thresholds])].sort((a, b) => a - b);
  const label = (percent: number) =>
    percent === 100 ? t("over") : t("percent", { percent: percentLabels[percent] ?? `${percent} %` });
  const toggle = (percent: number) =>
    setThresholds((list) =>
      list.includes(percent)
        ? list.filter((one) => one !== percent)
        : [...list, percent].sort((a, b) => a - b),
    );

  function addCustom() {
    const value = Number(custom.trim());
    if (!Number.isInteger(value) || value < 1 || value > 200) {
      setError(t("invalidCustom"));
      return;
    }
    if (!thresholds.includes(value) && thresholds.length >= MAX_ALERT_THRESHOLDS) {
      setError(t("tooMany", { count: MAX_ALERT_THRESHOLDS }));
      return;
    }
    setError(null);
    setCustom("");
    setThresholds((list) => [...new Set([...list, value])].sort((a, b) => a - b));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (enabled && thresholds.length === 0) {
      setError(t("none"));
      return;
    }
    if (thresholds.length > MAX_ALERT_THRESHOLDS) {
      setError(t("tooMany", { count: MAX_ALERT_THRESHOLDS }));
      return;
    }
    startTransition(async () => {
      const result = await saveBudgetAlertsAction(scope, { enabled, thresholds });
      if (!result.ok) {
        setError(result.error === "not_found" ? errors("not_found") : errors("failed"));
        return;
      }
      setError(null);
      notify(t("saved"), "success");
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" data-testid="budget-alerts">
      <Checkbox
        label={t("enabled")}
        checked={enabled}
        onChange={(event) => setEnabled(event.target.checked)}
      />
      {enabled && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1.5 text-sm font-medium">{t("thresholds")}</legend>
          <div className="flex flex-wrap gap-2">
            {shown.map((percent) => (
              <Chip key={percent} active={thresholds.includes(percent)} onClick={() => toggle(percent)}>
                {label(percent)}
              </Chip>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <Field label={t("custom")} htmlFor="budget-alert-custom">
              <Input
                id="budget-alert-custom"
                className="w-28 tabular-nums"
                type="number"
                inputMode="numeric"
                min={1}
                max={200}
                step={1}
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addCustom();
                  }
                }}
              />
            </Field>
            <Button type="button" onClick={addCustom} disabled={custom.trim() === ""}>
              {t("add")}
            </Button>
          </div>
        </fieldset>
      )}
      {error && (
        <p role="alert" className="text-sm text-neg">
          {error}
        </p>
      )}
      <CardFooter>
        <span className="text-sm text-muted">{enabled ? t("hint") : t("off")}</span>
        <Button type="submit" variant="primary" disabled={pending}>
          {t("save")}
        </Button>
      </CardFooter>
    </form>
  );
}
