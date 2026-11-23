"use client";

// «Account with value only» of «Add investment» (rewrite plan R5b, B1c, ST-3): a new account from four
// fields — name, kind, currency, value today — or an investment or crypto account of Accounts, which
// becomes a service. «Manual portfolio» (R5d) is the same dialog with neither the kind nor the value:
// its value is its cash and its positions.
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import { parseCents } from "@ledgerly/format/cents";
import { formatMoney, type NumberFormat } from "@ledgerly/format/format";
import { Field } from "@ledgerly/ui/field";
import { FormDialog } from "@ledgerly/ui/form-dialog";
import { Input, Select } from "@ledgerly/ui/input";
import { useRouter } from "@ledgerly/ui/router";
import { notify } from "@ledgerly/ui/toast";
import { createManualService, createPortfolio, createValueAccount } from "../calls";
import { FORM_GRID, useInvestmentResult } from "./dialog-kit";

/** An account of Accounts, as the dialogs of «Add investment» offer it. */
export interface ExistingChoice {
  id: string;
  name: string;
  currency: string;
  type: string;
  /** A decimal string of the wire. */
  balance: string | null;
  reason: string | null;
  /** A manual service a provider can be connected to (manual → synced, §2.5). */
  manualService?: boolean;
  /** Read by a source of Accounts: a manual service may show it, a provider may not write it (PERS-342). */
  synced?: boolean;
}

/** An account in the select: its name and balance. */
export function optionText(
  text: ReturnType<typeof useTranslations<"investments">>,
  one: ExistingChoice,
  numberFormat: NumberFormat,
): string {
  return text("manualForm.option", {
    name: one.name,
    balance: formatMoney(one.balance === null ? null : parseCents(one.balance), numberFormat, {
      currency: one.currency,
    }),
  });
}

const CATEGORIES = ["accounts", "broker", "crypto"] as const;
type Category = (typeof CATEGORIES)[number];
const REASONS = ["fund", "managed", "synced"] as const;
/** The choice of the select that makes a new account. */
const NEW = "new";
/** Every currency the browser knows, by its ISO code: the server says if it has no rate for one. */
const CURRENCIES = Intl.supportedValuesOf("currency");

/** Why an account cannot be picked, in words; nothing when it can. */
export function reasonText(
  text: ReturnType<typeof useTranslations<"investments">>,
  reason: string | null,
): string {
  const known = REASONS.find((one) => one === reason);
  return known ? ` — ${text(`manualForm.reasons.${known}`)}` : "";
}

/** The account the service is made of: a new one, or an eligible one of Accounts; the others say why not. */
function AccountField({
  id,
  existing,
  numberFormat,
  accountId,
  onChange,
}: {
  id: string;
  existing: readonly ExistingChoice[];
  numberFormat: NumberFormat;
  accountId: string;
  onChange: (accountId: string) => void;
}) {
  const text = useTranslations("investments");
  return (
    <div className="col-span-full">
      <Field
        label={text("manualForm.existing")}
        htmlFor={`${id}-account`}
        hint={text("manualForm.existingHint")}
      >
        <Select id={`${id}-account`} value={accountId} onChange={(event) => onChange(event.target.value)}>
          <option value={NEW}>{text("manualForm.newAccount")}</option>
          {existing.map((one) => (
            <option key={one.id} value={one.id} disabled={one.reason !== null}>
              {optionText(text, one, numberFormat)}
              {reasonText(text, one.reason)}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

/** The new account: its name, its currency and, for a service kept by value, its value today. */
function NewAccountFields({ id, currency, withValue }: { id: string; currency: string; withValue: boolean }) {
  const text = useTranslations("investments");
  return (
    <>
      <div className="col-span-full">
        <Field label={text("manualForm.name")} htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} name="name" required maxLength={80} autoComplete="off" />
        </Field>
      </div>
      <Field label={text("manualForm.currency")} htmlFor={`${id}-currency`}>
        <Select id={`${id}-currency`} name="currency" defaultValue={currency}>
          {CURRENCIES.map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </Select>
      </Field>
      {withValue && (
        <Field label={text("manualForm.value")} htmlFor={`${id}-value`}>
          <Input id={`${id}-value`} name="value" required inputMode="decimal" autoComplete="off" />
        </Field>
      )}
    </>
  );
}

/** The kind of service, when it is kept by value, and its web address. */
function ServiceFields({
  id,
  category,
  onCategory,
}: {
  id: string;
  category: Category | null;
  onCategory: (category: Category) => void;
}) {
  const text = useTranslations("investments");
  return (
    <>
      {category !== null && (
        <Field label={text("manualForm.category")} htmlFor={`${id}-category`}>
          <Select
            id={`${id}-category`}
            value={category}
            onChange={(event) => onCategory(CATEGORIES.find((one) => one === event.target.value) ?? "broker")}
          >
            {CATEGORIES.map((one) => (
              <option key={one} value={one}>
                {text(`categories.${one}`)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={text("manualForm.url")} htmlFor={`${id}-url`} hint={text("manualForm.urlHint")}>
        <Input
          id={`${id}-url`}
          name="url"
          type="url"
          inputMode="url"
          maxLength={500}
          placeholder="https://www.directa.it"
        />
      </Field>
    </>
  );
}

/** A new account and its service, or the service of an account of Accounts. */
function create(
  kind: AddKind,
  input: { accountId: string; name: string; category: Category; field: (name: string) => string },
) {
  const url = input.field("url");
  const fresh = input.accountId === NEW;
  if (kind === "portfolio")
    return createPortfolio(
      fresh
        ? { name: input.name, currency: input.field("currency"), url }
        : { accountId: input.accountId, url },
    );
  return fresh
    ? createValueAccount({
        name: input.name,
        category: input.category,
        currency: input.field("currency"),
        value: input.field("value"),
        url,
      })
    : createManualService({ accountId: input.accountId, category: input.category, url });
}

/** «Add»: a new account from its fields, or the service of an account of Accounts; then its page. */
function useSubmit(
  {
    kind,
    existing,
    accountId,
    category,
  }: { kind: AddKind; existing: readonly ExistingChoice[]; accountId: string; category: Category },
  onClose: () => void,
) {
  const text = useTranslations("investments");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { error, report } = useInvestmentResult();
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "");
    const name =
      accountId === NEW ? field("name").trim() : (existing.find((one) => one.id === accountId)?.name ?? "");
    startTransition(async () => {
      const result = await create(kind, { accountId, name, category, field });
      if (!report(result) || !result.ok) return;
      notify(text("toasts.serviceCreated", { name }));
      onClose();
      router.push(`/investments/${result.accountId}`);
    });
  }
  return { pending, error, onSubmit };
}

/** «Account with value only», or «Manual portfolio». */
type AddKind = "value" | "portfolio";

export function ValueAccountDialog({
  kind = "value",
  onClose,
  existing,
  numberFormat,
  currency,
}: {
  kind?: AddKind;
  onClose: () => void;
  existing: readonly ExistingChoice[];
  numberFormat: NumberFormat;
  /** The display currency: the new account's, unless another is picked. */
  currency: string;
}) {
  const text = useTranslations("investments");
  const id = useId();
  const [accountId, setAccountId] = useState(NEW);
  const [category, setCategory] = useState<Category>("broker");
  const { pending, error, onSubmit } = useSubmit({ kind, existing, accountId, category }, onClose);
  const words = kind === "portfolio" ? "portfolioForm" : "manualForm";
  return (
    <FormDialog
      onClose={onClose}
      title={text(`${words}.title`)}
      description={text(`${words}.description`)}
      width={520}
      className={FORM_GRID}
      onSubmit={onSubmit}
      error={error}
      pending={pending}
      cancelLabel={text("form.cancel")}
      submitLabel={text("manualForm.submit")}
    >
      <AccountField
        id={id}
        existing={existing}
        numberFormat={numberFormat}
        accountId={accountId}
        onChange={setAccountId}
      />
      {accountId === NEW && <NewAccountFields id={id} currency={currency} withValue={kind === "value"} />}
      <ServiceFields id={id} category={kind === "value" ? category : null} onCategory={setCategory} />
    </FormDialog>
  );
}
