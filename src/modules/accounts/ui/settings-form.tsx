"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button } from "@/ui/button";
import { CardFooter } from "@/ui/card";
import { Field } from "@/ui/field";
import { Checkbox, Input, Select } from "@/ui/input";
import { SettingsSection } from "@/ui/section";
import { notify } from "@/ui/toast";
import { removeAccountAction, restoreAccountAction, saveAccountSettingsAction } from "../actions";
import { colorField } from "./display";
import { ACCOUNT_TYPES, REMINDERS, TRENDS } from "../rules";

export interface SettingsValues {
  id: string;
  name: string;
  type: string;
  currency: string;
  provider: string | null;
  origin: "manual" | "synced";
  state: "active" | "unavailable" | "archived";
  color: string | null;
  reference: string | null;
  purpose: string | null;
  openedOn: string | null;
  notes: string | null;
  inNetWorth: boolean;
  inSnapshot: boolean;
  countsAsLiquid: boolean;
  /** The threshold already formatted in the user's number format, ready to be typed over. */
  lowBalance: string;
  staleAfterHours: number;
  reminder: string;
  betweenEntries: string;
}

/**
 * Account detail › Settings: the General card of the earlier design (spec §8.4.8), the data source,
 * what the account counts towards, and archiving. A synced account keeps the provider's type and
 * currency, so those two controls are read-only rather than merely ignored on save.
 */
export function AccountSettingsForm({
  account,
  index,
  today,
}: {
  account: SettingsValues;
  /** The account's place in the list, the one `colorFor` colours it by. */
  index: number;
  today: string;
}) {
  const t = useTranslations("accounts.settings");
  const types = useTranslations("accounts.types");
  const common = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const synced = account.origin === "synced";
  const colour = colorField(account, index);
  // Checked, the account has no colour of its own and keeps none: the swatch beside it shows the
  // palette colour it is drawn with, and the save writes `null` rather than freezing that colour in.
  const [automatic, setAutomatic] = useState(colour.automatic);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    startTransition(async () => {
      try {
        const result = await saveAccountSettingsAction(account.id, {
          name: text("name"),
          type: text("type"),
          currency: text("currency") || "EUR",
          color: automatic ? null : text("color") || null,
          reference: text("reference"),
          purpose: text("purpose"),
          openedOn: text("openedOn") || null,
          notes: text("notes"),
          inNetWorth: data.get("inNetWorth") === "on",
          inSnapshot: data.get("inSnapshot") === "on",
          countsAsLiquid: data.get("countsAsLiquid") === "on",
          lowBalance: text("lowBalance") || null,
          staleAfterHours: Number(text("staleAfterHours")),
          reminder: text("reminder"),
          betweenEntries: text("betweenEntries"),
        });
        if (!result.ok) {
          setError(t("errors.invalid"));
          return;
        }
        setError(null);
        notify(t("saved"));
      } catch {
        setError(t("errors.failed"));
      }
    });
  }

  function onRemove() {
    startTransition(async () => {
      const result = await removeAccountAction(account.id);
      if (!result.ok) {
        setError(t("errors.failed"));
        return;
      }
      router.push("/accounts" as Route);
    });
  }

  function onRestore() {
    startTransition(async () => {
      const result = await restoreAccountAction(account.id);
      if (!result.ok) setError(t("errors.failed"));
      else notify(t("restored"));
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {error && (
        <p role="alert" className="text-sm text-neg">
          {error}
        </p>
      )}

      <SettingsSection title={t("general.title")} description={t("general.description")}>
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <Field label={t("general.name")} htmlFor="name">
            <Input id="name" name="name" defaultValue={account.name} maxLength={80} required />
          </Field>
          <Field
            label={t("general.provider")}
            htmlFor="provider"
            hint={synced ? undefined : t("general.manualProvider")}
          >
            <Input id="provider" name="provider" value={account.provider ?? "—"} readOnly />
          </Field>
          <Field label={t("general.type")} htmlFor="type" hint={synced ? t("general.locked") : undefined}>
            <Select id="type" name="type" defaultValue={account.type} disabled={synced}>
              {ACCOUNT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {types(type)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("general.purpose")} htmlFor="purpose">
            <Input id="purpose" name="purpose" defaultValue={account.purpose ?? ""} maxLength={120} />
          </Field>
          <Field label={t("general.reference")} htmlFor="reference">
            <Input
              id="reference"
              name="reference"
              defaultValue={account.reference ?? ""}
              maxLength={64}
              className="font-mono"
            />
          </Field>
          <Field label={t("general.color")} htmlFor="color" hint={t("general.colorHint")}>
            <div className="flex items-center gap-3">
              <Input
                id="color"
                name="color"
                type="color"
                defaultValue={colour.value}
                disabled={automatic}
                className="p-1"
              />
              <Checkbox
                label={t("general.automaticColor")}
                checked={automatic}
                onChange={(event) => setAutomatic(event.target.checked)}
              />
            </div>
          </Field>
          <Field
            label={t("general.currency")}
            htmlFor="currency"
            hint={synced ? t("general.locked") : undefined}
          >
            <Input id="currency" name="currency" defaultValue={account.currency} maxLength={3} readOnly />
          </Field>
          <Field label={t("general.openedOn")} htmlFor="openedOn">
            <Input
              id="openedOn"
              name="openedOn"
              type="date"
              max={today}
              defaultValue={account.openedOn ?? ""}
            />
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection title={t("source.title")} description={t("source.description")}>
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <p className="text-sm text-muted sm:col-span-2">
            {synced ? t("source.syncedNote", { provider: account.provider ?? "" }) : t("source.manualNote")}
          </p>
          <Field label={t("source.reminder")} htmlFor="reminder">
            <Select id="reminder" name="reminder" defaultValue={account.reminder}>
              {REMINDERS.map((value) => (
                <option key={value} value={value}>
                  {t(`source.reminders.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("source.betweenEntries")} htmlFor="betweenEntries" hint={t("source.trendHint")}>
            <Select id="betweenEntries" name="betweenEntries" defaultValue={account.betweenEntries}>
              {TRENDS.map((value) => (
                <option key={value} value={value}>
                  {t(`source.trends.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          {synced && (
            <Field label={t("source.staleAfter")} htmlFor="staleAfterHours">
              <Input
                id="staleAfterHours"
                name="staleAfterHours"
                type="number"
                min={1}
                max={8760}
                defaultValue={account.staleAfterHours}
                numeric
              />
            </Field>
          )}
          {!synced && <input type="hidden" name="staleAfterHours" value={account.staleAfterHours} readOnly />}
        </div>
      </SettingsSection>

      <SettingsSection title={t("reporting.title")} description={t("reporting.description")}>
        <div className="flex flex-col gap-2.5">
          <Checkbox name="inNetWorth" label={t("reporting.inNetWorth")} defaultChecked={account.inNetWorth} />
          <Checkbox name="inSnapshot" label={t("reporting.inSnapshot")} defaultChecked={account.inSnapshot} />
          <Checkbox
            name="countsAsLiquid"
            label={t("reporting.countsAsLiquid")}
            defaultChecked={account.countsAsLiquid}
          />
          <Field label={t("reporting.lowBalance")} htmlFor="lowBalance" hint={t("reporting.lowBalanceHint")}>
            <Input
              id="lowBalance"
              name="lowBalance"
              inputMode="decimal"
              defaultValue={account.lowBalance}
              numeric
            />
          </Field>
          <Field label={t("reporting.notes")} htmlFor="notes">
            <Input id="notes" name="notes" defaultValue={account.notes ?? ""} maxLength={2000} />
          </Field>
        </div>
        <CardFooter>
          <span className="text-sm text-muted">{t("reporting.footnote")}</span>
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            {common("save")}
          </Button>
        </CardFooter>
      </SettingsSection>

      <SettingsSection title={t("danger.title")} description={t("danger.description")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {account.state === "archived" ? t("danger.archived") : t("danger.explain")}
          </p>
          {account.state === "archived" ? (
            <Button size="sm" onClick={onRestore} disabled={pending}>
              {t("danger.restore")}
            </Button>
          ) : (
            <Button variant="danger" size="sm" onClick={onRemove} disabled={pending}>
              {t("danger.archive")}
            </Button>
          )}
        </div>
      </SettingsSection>
    </form>
  );
}
