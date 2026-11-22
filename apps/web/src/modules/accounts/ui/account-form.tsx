"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, ButtonLink } from "@ledgerly/ui/button";
import { CardFooter } from "@ledgerly/ui/card";
import { Field } from "@ledgerly/ui/field";
import { Input, Select } from "@ledgerly/ui/input";
import { createAccountAction } from "../calls";
import { PALETTE } from "@ledgerly/design-tokens";
import { ColorPicker } from "@ledgerly/ui/color-picker";
import { colorField } from "./display";
import { ACCOUNT_TYPES, type AccountType, hasIbanField } from "@ledgerly/domain/accounts/client";
import { ibanErrorText } from "./iban-field";
import { FIELD_GRID } from "@ledgerly/ui/section";
import { accounts as accountRoutes } from "@ledgerly/api-contract/accounts";
import { profile } from "@ledgerly/api-contract/settings";
import { today } from "@ledgerly/domain/shared/dates";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";

/**
 * A new manual account, with the optional opening balance of spec §7.1. The amount stays text all
 * the way to the call, which reads it in the user's own number format.
 */
/**
 * "New account" with what it reads from `/api/v1`: today in the person's zone, and the place the new
 * account takes — last among the open ones, the list the Accounts page colours by — so its colour
 * preview is the one it will really have.
 */
export function NewAccountForm() {
  const preferences = useApi(profile.getPreferences, {});
  const open = useApi(accountRoutes.listAccounts, {});
  return (
    <Loaded state={preferences}>
      {(prefs) => (
        <Loaded state={open}>
          {({ accounts }) => <AccountForm today={today(prefs.timeZone)} index={accounts.length} />}
        </Loaded>
      )}
    </Loaded>
  );
}

function AccountForm({ today: todayOn, index }: { today: string; index: number }) {
  const t = useTranslations("accounts.new");
  const types = useTranslations("accounts.types");
  const settings = useTranslations("accounts.settings");
  const common = useTranslations("common");
  const [type, setType] = useState<AccountType>("checking");
  const [ibanError, setIbanError] = useState<string | null>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The colour the account will be drawn with once it exists: the palette's, for the place it
  // takes at the end of the list. Left automatic, it stays the palette's and follows any reordering.
  const colour = colorField({ color: null }, index);
  const [chosen, setChosen] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    const balance = text("balance");
    startTransition(async () => {
      try {
        const result = await createAccountAction({
          name: text("name"),
          type: text("type"),
          currency: text("currency") || "EUR",
          color: text("color") || null,
          reference: text("reference"),
          iban: hasIbanField(type) ? text("iban") : "",
          purpose: text("purpose"),
          openedOn: text("openedOn") || null,
          notes: "",
          openingBalance: balance === "" ? null : { on: text("balanceOn") || todayOn, amount: balance },
        });
        if (!result.ok) {
          // The IBAN's error goes under its field (ux/n4-account-switch.md §2.4.1).
          const onIban = ibanErrorText(result, settings);
          setIbanError(onIban);
          setError(
            onIban !== null ? null : t(`errors.${result.error === "future_date" ? "futureDate" : "invalid"}`),
          );
          return;
        }
        router.push(`/accounts/${result.id}` as Route);
      } catch {
        setError(t("errors.failed"));
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className={FIELD_GRID}>
      {error && (
        <p role="alert" className="text-sm text-neg col-span-full">
          {error}
        </p>
      )}
      <Field label={t("name")} htmlFor="name">
        <Input id="name" name="name" maxLength={80} required autoFocus />
      </Field>
      <Field label={t("type")} htmlFor="type">
        <Select
          id="type"
          name="type"
          value={type}
          onChange={(event) => setType(event.currentTarget.value as AccountType)}
        >
          {ACCOUNT_TYPES.map((type) => (
            <option key={type} value={type}>
              {types(type)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("purpose")} htmlFor="purpose" hint={t("purposeHint")}>
        <Input id="purpose" name="purpose" maxLength={120} />
      </Field>
      <Field label={t("reference")} htmlFor="reference">
        <Input id="reference" name="reference" maxLength={64} className="font-mono" />
      </Field>
      {hasIbanField(type) && (
        <Field label={settings("general.iban")} htmlFor="iban" error={ibanError ?? undefined}>
          <Input
            id="iban"
            name="iban"
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            className="font-mono tabular-nums"
          />
        </Field>
      )}
      <Field label={t("currency")} htmlFor="currency">
        <Input id="currency" name="currency" defaultValue="EUR" maxLength={3} readOnly />
      </Field>
      <Field label={t("color")} htmlFor="color" hint={t("colorHint")}>
        <ColorPicker
          swatches={PALETTE}
          fallback={colour.value}
          id="color"
          name="color"
          value={chosen}
          clearLabel={t("automaticColor")}
          onChange={setChosen}
        />
      </Field>
      <Field label={t("openedOn")} htmlFor="openedOn">
        <Input id="openedOn" name="openedOn" type="date" max={todayOn} />
      </Field>
      <div />
      <Field label={t("openingBalance")} htmlFor="balance" hint={t("openingBalanceHint")}>
        <Input id="balance" name="balance" inputMode="decimal" numeric />
      </Field>
      <Field label={t("openingBalanceOn")} htmlFor="balanceOn">
        <Input id="balanceOn" name="balanceOn" type="date" max={todayOn} defaultValue={todayOn} />
      </Field>
      <CardFooter>
        <ButtonLink href="/accounts" size="sm">
          {common("cancel")}
        </ButtonLink>
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {t("submit")}
        </Button>
      </CardFooter>
    </form>
  );
}
