"use client";

// The key of a provider (§4.2, §5): its fields, write only, and «Connect». A key
// stays in the page no longer than the call: the fields are cleared whatever the answer. «Connect a
// service» of «Add investment» opens it.
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import type { NumberFormat } from "@ledgerly/format/format";
import { Button } from "@ledgerly/ui/button";
import { Field } from "@ledgerly/ui/field";
import { FormDialog } from "@ledgerly/ui/form-dialog";
import { Input, Select } from "@ledgerly/ui/input";
import { Modal } from "@ledgerly/ui/modal";
import { useRouter } from "@ledgerly/ui/router";
import { notify } from "@ledgerly/ui/toast";
import { connectProvider } from "../calls";
import { FORM_GRID, useInvestmentResult } from "./dialog-kit";
import { useProviderWords } from "./provider-words";
import { type ExistingChoice, optionText, reasonText } from "./manual-service";

export interface ConnectableProvider {
  id: string;
  name: string;
  /** The account type its service is (D13): an exchange is `crypto`, a broker `investment`. */
  accountType: "investment" | "crypto";
  ipWhitelist: "supported" | "unsupported" | null;
  credentialFields: readonly string[];
  currencies: readonly string[] | null;
  defaultCurrency: string;
  url: string | null;
  revokeUrl: string | null;
}

const FIELDS = ["api_key", "user_key", "secret"] as const;
const STEPS = ["1", "2", "3", "4"] as const;

type Text = ReturnType<typeof useTranslations<"investments">>;

/** A key field's name in words; a field the catalogue does not know is shown as named. */
function fieldLabel(text: Text, field: string): string {
  const known = FIELDS.find((one) => one === field);
  return known ? text(`connect.fields.${known}`) : field;
}

/** The key fields of a provider: write only, never filled back, never kept by the browser. */
export function KeyFields({ provider, id }: { provider: ConnectableProvider; id: string }) {
  const text = useTranslations("investments");
  return (
    <>
      {provider.credentialFields.map((field) => (
        <Field key={field} label={fieldLabel(text, field)} htmlFor={`${id}-${field}`}>
          <Input
            id={`${id}-${field}`}
            name={field}
            type="password"
            required
            autoComplete="off"
            spellCheck={false}
            maxLength={4096}
          />
        </Field>
      ))}
    </>
  );
}

/** The typed key, read once from the form. */
export function keysOf(provider: ConnectableProvider, form: HTMLFormElement): Record<string, string> {
  const data = new FormData(form);
  return Object.fromEntries(
    provider.credentialFields.map((field) => [field, String(data.get(field) ?? "").trim()]),
  );
}

/** Empties the key fields, whatever the answer was. */
export function clearKeys(provider: ConnectableProvider, form: HTMLFormElement): void {
  for (const field of provider.credentialFields) {
    const input = form.elements.namedItem(field);
    if (input instanceof HTMLInputElement) input.value = "";
  }
}

/** Connected with a key that works from any IP (PERS-87 SEC-02): said before the service opens. */
function UnrestrictedNotice({ provider, onOpen }: { provider: ConnectableProvider; onOpen: () => void }) {
  const text = useTranslations("investments");
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onOpen()}
      title={text("connect.ipUnrestrictedTitle", { name: provider.name })}
      width={520}
      footer={
        <Button variant="primary" onClick={onOpen}>
          {text("connect.openService")}
        </Button>
      }
    >
      <p role="status" className="text-sm text-warn">
        {text("connect.ipUnrestricted", { name: provider.name })}
      </p>
    </Modal>
  );
}

/** How to make a read-only key at the provider, and what the IP restriction means there. */
function ConnectSteps({ provider }: { provider: ConnectableProvider }) {
  const text = useTranslations("investments");
  // Message keys cannot hold a colon: the provider's id with `_` for every other sign.
  const steps = useProviderWords(provider.id)?.steps;
  return (
    <>
      {steps && (
        <ol className="col-span-full flex list-decimal flex-col gap-1 pl-5 text-sm">
          {STEPS.map((step) => (
            <li key={step}>{steps[step]}</li>
          ))}
        </ol>
      )}
      <p className="col-span-full text-sm text-muted">
        {text("connect.readOnlyNote")}{" "}
        {text(provider.ipWhitelist === "supported" ? "connect.ipSuggested" : "connect.ipUnsupported", {
          name: provider.name,
        })}
      </p>
    </>
  );
}

/** Why an account cannot take the key, in words. */
function refusalOf(text: Text, one: ExistingChoice, currencies: readonly string[], usable: boolean): string {
  if (!currencies.includes(one.currency)) return ` — ${text("connect.currencyNotSupported")}`;
  if (one.synced) return ` — ${text("manualForm.reasons.synced")}`;
  return usable ? "" : reasonText(text, one.reason);
}

/** The account the key is connected to: one of the provider's type, in a currency it reads. */
function KeyAccountField({
  id,
  provider,
  choices,
  usable,
  numberFormat,
  accountId,
  onChange,
}: {
  id: string;
  provider: ConnectableProvider;
  choices: readonly ExistingChoice[];
  usable: (one: ExistingChoice) => boolean;
  numberFormat: NumberFormat;
  accountId: string;
  onChange: (accountId: string) => void;
}) {
  const text = useTranslations("investments");
  const currencies = provider.currencies ?? [provider.defaultCurrency];
  return (
    <div className="col-span-full">
      <Field
        label={text("manualForm.existing")}
        htmlFor={`${id}-account`}
        hint={text("connect.existingHint", { name: provider.name })}
      >
        {choices.length === 0 ? (
          <p className="text-sm text-muted">{text("manualForm.noExisting")}</p>
        ) : (
          <Select id={`${id}-account`} value={accountId} onChange={(event) => onChange(event.target.value)}>
            {choices.map((one) => (
              <option key={one.id} value={one.id} disabled={!usable(one)}>
                {optionText(text, one, numberFormat)}
                {refusalOf(text, one, currencies, usable(one))}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}

/** «Connect»: the call, the fields emptied whatever the answer, then the service — or the IP notice. */
function useConnect(provider: ConnectableProvider, accountId: string, onClose: () => void) {
  const text = useTranslations("investments");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { error, report } = useInvestmentResult();
  // Connected with a key that works from any IP (PERS-87 SEC-02): said here before the page opens.
  const [unrestricted, setUnrestricted] = useState<string | null>(null);
  const open = (serviceId: string) => {
    onClose();
    router.push(`/investments/${serviceId}`);
  };
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const keys = keysOf(provider, form);
    startTransition(async () => {
      const result = await connectProvider(provider.id, keys, accountId);
      clearKeys(provider, form);
      if (!report(result) || !result.ok) return;
      notify(text("toasts.connected", { name: provider.name }));
      if (result.ipRestricted === false) setUnrestricted(result.accountId);
      else open(result.accountId);
    });
  }
  return { pending, error, unrestricted, open, onSubmit };
}

export function ConnectDialog({
  onClose,
  provider,
  existing,
  numberFormat,
}: {
  onClose: () => void;
  provider: ConnectableProvider;
  existing: readonly ExistingChoice[];
  numberFormat: NumberFormat;
}) {
  const text = useTranslations("investments");
  const id = useId();
  const currencies = provider.currencies ?? [provider.defaultCurrency];
  const choices = existing.filter((one) => one.type === provider.accountType);
  // A provider writes the account: never one a source of Accounts reads (PERS-342), which would have two writers.
  const usable = (one: ExistingChoice) =>
    (one.reason === null || one.manualService === true) &&
    one.synced !== true &&
    currencies.includes(one.currency);
  const [accountId, setAccountId] = useState(choices.find(usable)?.id ?? "");
  const { pending, error, unrestricted, open, onSubmit } = useConnect(provider, accountId, onClose);
  if (unrestricted !== null)
    return <UnrestrictedNotice provider={provider} onOpen={() => open(unrestricted)} />;
  return (
    <FormDialog
      onClose={onClose}
      title={text("connect.title", { name: provider.name })}
      description={text("connect.description")}
      width={520}
      className={FORM_GRID}
      onSubmit={onSubmit}
      error={error}
      pending={pending || accountId === ""}
      cancelLabel={text("form.cancel")}
      submitLabel={pending ? text("connect.checking") : text("connect.submit")}
    >
      <ConnectSteps provider={provider} />
      <KeyFields provider={provider} id={id} />
      <KeyAccountField
        id={id}
        provider={provider}
        choices={choices}
        usable={usable}
        numberFormat={numberFormat}
        accountId={accountId}
        onChange={setAccountId}
      />
    </FormDialog>
  );
}
