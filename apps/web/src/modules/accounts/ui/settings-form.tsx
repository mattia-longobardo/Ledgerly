"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useRef, useState, useTransition } from "react";
import { accounts, views } from "@ledgerly/api-contract/accounts";
import { Button } from "@ledgerly/ui/button";
import { CardFooter } from "@ledgerly/ui/card";
import { invalidate } from "@ledgerly/ui/data";
import { Field } from "@ledgerly/ui/field";
import { Modal } from "@ledgerly/ui/modal";
import { Checkbox, Input, Select } from "@ledgerly/ui/input";
import { SettingsSection, FIELD_GRID } from "@ledgerly/ui/section";
import { notify } from "@ledgerly/ui/toast";
import { useUnsavedForm } from "@ledgerly/ui/unsaved-changes";
import { archiveAccountAction, restoreAccountAction, saveAccountSettingsAction } from "../calls";
import { PALETTE } from "@ledgerly/design-tokens";
import { ColorPicker } from "@ledgerly/ui/color-picker";
import { colorField } from "./display";
import { ibanErrorText } from "./iban-field";
import { ACCOUNT_TYPES, REMINDERS, TRENDS } from "@ledgerly/domain/accounts/client";

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
  /** The account's IBAN, grouped by four for the field; `null` when none or the type has no field (H47). */
  iban: string | null;
  /** The IBAN came from the source: the field is read-only. */
  ibanFromSource: boolean;
  /** The type has the IBAN field (H47). */
  ibanField: boolean;
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
 * what the account counts towards, and archiving. A synced account keeps the provider's currency,
 * so that control is read-only rather than merely ignored on save; its type follows the provider
 * until it is changed here, and the hint says the change stays here (Wallet cannot take it).
 */
export function AccountSettingsForm({
  account,
  index,
  today,
  sourceExtra,
  deleteControl,
  twin = null,
}: {
  account: SettingsValues;
  /** The name of the account this one doubles (H58, `GET /accounts/{id}/twin`), or null. */
  twin?: string | null;
  /** The account's place in the list, the one `colorFor` colours it by. */
  index: number;
  today: string;
  /** The block of the switch to the bank (ux/n4-account-switch.md §2.2 and §9.1), drawn by the page. */
  sourceExtra?: ReactNode;
  /** "Delete account" with its dialog, drawn by the page: it moves what rests on the account first (PERS-419). */
  deleteControl?: ReactNode;
}) {
  const t = useTranslations("accounts.settings");
  const types = useTranslations("accounts.types");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ibanError, setIbanError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const unsaved = useUnsavedForm(formRef, pending);
  const synced = account.origin === "synced";
  const colour = colorField(account, index);
  // `null` is «Automatic colour»: the account keeps no colour of its own, the native swatch shows the
  // palette colour it is drawn with, and the save writes `null` rather than freezing that colour in.
  const [chosen, setChosen] = useState<string | null>(colour.automatic ? null : colour.value);

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
          color: text("color") || null,
          reference: text("reference"),
          iban: account.ibanField && !account.ibanFromSource ? text("iban") : "",
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
          const onIban = ibanErrorText(result, t);
          setIbanError(onIban);
          if (onIban === null) {
            setError(t(result.error === "managed_locked" ? "errors.managed" : "errors.invalid"));
          } else setError(null);
          return;
        }
        setError(null);
        setIbanError(null);
        unsaved.saved();
        notify(t("saved"));
      } catch {
        setError(t("errors.failed"));
      }
    });
  }

  /** Archiving is the safe half: it never deletes, and `onRestore` undoes it. */
  function onArchive() {
    setConfirming(false);
    startTransition(async () => {
      const result = await archiveAccountAction(account.id);
      if (!result.ok) {
        setError(t("errors.failed"));
        return;
      }
      notify(t("danger.archivedToast", { name: account.name }));
      invalidate(accounts.getAccount, accounts.getAccountTwin, views.getNetWorth, views.getAccountContext);
    });
  }

  function onRestore() {
    startTransition(async () => {
      const result = await restoreAccountAction(account.id);
      if (!result.ok) {
        setError(t("errors.failed"));
        return;
      }
      notify(t("restored"));
      invalidate(accounts.getAccount, accounts.getAccountTwin, views.getNetWorth, views.getAccountContext);
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-6">
      {error && (
        <p role="alert" className="text-sm text-neg">
          {error}
        </p>
      )}

      <SettingsSection title={t("general.title")} description={t("general.description")}>
        <div className={FIELD_GRID}>
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
          <Field label={t("general.type")} htmlFor="type" hint={synced ? t("general.typeSynced") : undefined}>
            <Select id="type" name="type" defaultValue={account.type}>
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
          {account.ibanField && (
            <Field
              label={t("general.iban")}
              htmlFor="iban"
              hint={
                account.ibanFromSource
                  ? t("general.ibanFromSource", { provider: account.provider ?? "" })
                  : undefined
              }
              error={ibanError ?? undefined}
            >
              <Input
                id="iban"
                name="iban"
                defaultValue={account.iban ?? ""}
                readOnly={account.ibanFromSource}
                maxLength={64}
                autoComplete="off"
                spellCheck={false}
                inputMode="text"
                className="font-mono tabular-nums"
              />
            </Field>
          )}
          <Field label={t("general.color")} htmlFor="color" hint={t("general.colorHint")}>
            <ColorPicker
              swatches={PALETTE}
              fallback={colour.value}
              id="color"
              name="color"
              value={chosen}
              clearLabel={t("general.automaticColor")}
              onChange={setChosen}
            />
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
        <div className={FIELD_GRID}>
          <p className="text-sm text-muted col-span-full">
            {synced ? t("source.syncedNote", { provider: account.provider ?? "" }) : t("source.manualNote")}
          </p>
          {sourceExtra && <div className="flex flex-col gap-2 col-span-full">{sourceExtra}</div>}
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
        </CardFooter>
      </SettingsSection>

      <SettingsSection title={t("danger.title")} description={t("danger.description")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {account.state !== "archived"
              ? t("danger.explain")
              : twin === null
                ? t("danger.archived")
                : t("danger.archivedDouble", { twin })}
          </p>
          <div className="flex flex-wrap gap-2">
            {/* Two intentions, two buttons: archiving keeps everything and can be undone, and
                deleting deletes. Neither does the other's job in secret. An archived account is
                restored or deleted (PERS-421). */}
            {account.state === "archived" ? (
              <Button size="sm" onClick={onRestore} disabled={pending}>
                {t("danger.restore")}
              </Button>
            ) : (
              // A double is archived only after the dialog says what changes (H58).
              <Button
                size="sm"
                onClick={twin === null ? onArchive : () => setConfirming(true)}
                disabled={pending}
              >
                {t("danger.archive")}
              </Button>
            )}
            {deleteControl}
          </div>
        </div>
        {twin !== null && (
          <Modal
            open={confirming}
            onOpenChange={setConfirming}
            title={t("danger.doubleTitle", { name: account.name })}
            footer={
              <>
                <Button onClick={() => setConfirming(false)}>{t("danger.cancel")}</Button>
                <Button variant="primary" onClick={onArchive}>
                  {t("danger.archive")}
                </Button>
              </>
            }
          >
            <p className="text-sm">{t("danger.doubleBody", { name: account.name, twin })}</p>
          </Modal>
        )}
      </SettingsSection>
    </form>
  );
}
