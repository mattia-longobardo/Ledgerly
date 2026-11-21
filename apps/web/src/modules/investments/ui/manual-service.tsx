"use client";

// «Manual account» of the catalog: an investment or crypto account of Accounts becomes a service.
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import { parseCents } from "@ledgerly/format/cents";
import { formatMoney, type NumberFormat } from "@ledgerly/format/format";
import { Field } from "@ledgerly/ui/field";
import { FormDialog } from "@ledgerly/ui/form-dialog";
import { Input, Select } from "@ledgerly/ui/input";
import { useRouter } from "@ledgerly/ui/router";
import { notify } from "@ledgerly/ui/toast";
import { createManualService } from "../calls";
import { FORM_GRID, Opener, useInvestmentResult } from "./dialog-kit";

/** An account of Accounts, as the catalog's dialogs offer it. */
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

export function CreateManualServiceButton({
  existing,
  numberFormat,
  variant = "primary",
}: {
  existing: readonly ExistingChoice[];
  numberFormat: NumberFormat;
  variant?: "primary" | "secondary";
}) {
  const text = useTranslations("investments");
  return (
    <Opener label={text("actions.createManual")} variant={variant}>
      {(close) => <ManualServiceDialog onClose={close} existing={existing} numberFormat={numberFormat} />}
    </Opener>
  );
}

const CATEGORIES = ["accounts", "broker", "crypto"] as const;
const REASONS = ["fund", "managed", "synced"] as const;

/** Why an account cannot be picked, in words; nothing when it can. */
export function reasonText(
  text: ReturnType<typeof useTranslations<"investments">>,
  reason: string | null,
): string {
  const known = REASONS.find((one) => one === reason);
  return known ? ` — ${text(`manualForm.reasons.${known}`)}` : "";
}

/** The account the service is made of: the eligible ones can be picked, the others say why not. */
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
        {existing.length === 0 ? (
          <p className="text-sm text-muted">{text("manualForm.noExisting")}</p>
        ) : (
          <Select id={`${id}-account`} value={accountId} onChange={(event) => onChange(event.target.value)}>
            {existing.map((one) => (
              <option key={one.id} value={one.id} disabled={one.reason !== null}>
                {optionText(text, one, numberFormat)}
                {reasonText(text, one.reason)}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}

/** The kind of service and its web address. */
function ServiceFields({
  id,
  category,
  onCategory,
}: {
  id: string;
  category: (typeof CATEGORIES)[number];
  onCategory: (category: (typeof CATEGORIES)[number]) => void;
}) {
  const text = useTranslations("investments");
  return (
    <>
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

function ManualServiceDialog({
  onClose,
  existing,
  numberFormat,
}: {
  onClose: () => void;
  existing: readonly ExistingChoice[];
  numberFormat: NumberFormat;
}) {
  const text = useTranslations("investments");
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { error, report } = useInvestmentResult();
  const [accountId, setAccountId] = useState(existing.find((one) => one.reason === null)?.id ?? "");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("broker");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = String(new FormData(event.currentTarget).get("url") ?? "");
    const name = existing.find((one) => one.id === accountId)?.name ?? "";
    startTransition(async () => {
      const result = await createManualService({ accountId, category, url });
      if (!report(result) || !result.ok) return;
      notify(text("toasts.serviceCreated", { name }));
      onClose();
      router.push(`/investments/${result.accountId}`);
    });
  }

  return (
    <FormDialog
      onClose={onClose}
      title={text("manualForm.title")}
      description={text("manualForm.description")}
      width={520}
      className={FORM_GRID}
      onSubmit={onSubmit}
      error={error}
      pending={pending || accountId === ""}
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
      <ServiceFields id={id} category={category} onCategory={setCategory} />
    </FormDialog>
  );
}
