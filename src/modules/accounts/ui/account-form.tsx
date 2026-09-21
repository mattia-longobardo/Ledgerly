"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, ButtonLink } from "@/ui/button";
import { CardFooter } from "@/ui/card";
import { Field } from "@/ui/field";
import { Checkbox, Input, Select } from "@/ui/input";
import { createAccountAction } from "../actions";
import { colorField } from "./display";
import { ACCOUNT_TYPES } from "../rules";

/**
 * A new manual account, with the optional opening balance of spec §7.1. The amount stays text all
 * the way to the Server Action, which reads it in the user's own number format.
 */
export function AccountForm({ today, index }: { today: string; index: number }) {
  const t = useTranslations("accounts.new");
  const types = useTranslations("accounts.types");
  const common = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The colour the account will be drawn with once it exists: the palette's, for the place it
  // takes at the end of the list. Left automatic, it stays the palette's and follows any reordering.
  const colour = colorField({ color: null }, index);
  const [automatic, setAutomatic] = useState(true);

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
          color: automatic ? null : text("color") || null,
          reference: text("reference"),
          purpose: text("purpose"),
          openedOn: text("openedOn") || null,
          notes: "",
          openingBalance: balance === "" ? null : { on: text("balanceOn") || today, amount: balance },
        });
        if (!result.ok) {
          setError(t(`errors.${result.error === "future_date" ? "futureDate" : "invalid"}`));
          return;
        }
        router.push(`/accounts/${result.id}` as Route);
      } catch {
        setError(t("errors.failed"));
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      {error && (
        <p role="alert" className="text-sm text-neg sm:col-span-2">
          {error}
        </p>
      )}
      <Field label={t("name")} htmlFor="name">
        <Input id="name" name="name" maxLength={80} required autoFocus />
      </Field>
      <Field label={t("type")} htmlFor="type">
        <Select id="type" name="type" defaultValue="checking">
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
      <Field label={t("currency")} htmlFor="currency">
        <Input id="currency" name="currency" defaultValue="EUR" maxLength={3} readOnly />
      </Field>
      <Field label={t("color")} htmlFor="color" hint={t("colorHint")}>
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
            label={t("automaticColor")}
            checked={automatic}
            onChange={(event) => setAutomatic(event.target.checked)}
          />
        </div>
      </Field>
      <Field label={t("openedOn")} htmlFor="openedOn">
        <Input id="openedOn" name="openedOn" type="date" max={today} />
      </Field>
      <div />
      <Field label={t("openingBalance")} htmlFor="balance" hint={t("openingBalanceHint")}>
        <Input id="balance" name="balance" inputMode="decimal" numeric />
      </Field>
      <Field label={t("openingBalanceOn")} htmlFor="balanceOn">
        <Input id="balanceOn" name="balanceOn" type="date" max={today} defaultValue={today} />
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
