"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState, useTransition } from "react";
import { Button, LinkButton } from "@/ui/button";
import { Field } from "@/ui/field";
import { Checkbox, Input, InputGroup, Select } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import { type ActionResult, createRuleAction, setRuleStateAction, updateRuleAction } from "../actions";

/** What the dialog starts from, every value already written the way the person types it. */
export interface RuleDraft {
  id: string | null;
  accountId: string;
  accountName: string;
  validFrom: string;
  validTo: string;
  tiers: { upTo: string; rate: string }[];
  tax: string;
  dayBasis: "365" | "360";
  settlement: "daily" | "monthly" | "quarterly" | "annual";
  payeeMatch: string;
  publish: boolean;
  active: boolean;
}

const KNOWN = ["invalid", "not_found", "invalid_account", "invalid_tiers", "not_synced"];

/**
 * The design's interest rule dialog, with what spec §7.6 adds (plan F4 §3.6.2): an end date, the
 * day basis, the text that recognises the bank's payment, and publishing to Wallet. The last tier
 * is always "above": only the tiers before it have a threshold.
 */
export function RuleDialog({
  draft,
  accounts,
  onClose,
}: {
  draft: RuleDraft;
  accounts: readonly { id: string; name: string }[];
  onClose: () => void;
}) {
  const t = useTranslations("interests");
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tiers, setTiers] = useState(draft.tiers);

  function setTier(index: number, field: "upTo" | "rate", value: string) {
    setTiers((current) => current.map((tier, i) => (i === index ? { ...tier, [field]: value } : tier)));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    const input = {
      accountId: text("account"),
      validFrom: text("from"),
      validTo: text("to"),
      tiers,
      tax: text("tax"),
      dayBasis: text("basis"),
      settlement: text("settlement"),
      payeeMatch: text("match"),
      publish: data.get("publish") === "on",
      active: data.get("active") === "on",
    };
    startTransition(async () => {
      const result: ActionResult = draft.id
        ? await updateRuleAction(draft.id, input)
        : await createRuleAction(input);
      if (!result.ok) {
        setError(t(`errors.${KNOWN.includes(result.error) ? result.error : "failed"}` as "errors.failed"));
        return;
      }
      notify(t("toasts.saved"));
      onClose();
      if (!draft.id && result.id) router.push(`/interests/${result.id}`);
    });
  }

  return (
    <Modal
      open
      onOpenChange={(next) => !next && onClose()}
      title={draft.id ? t("form.editTitle", { account: draft.accountName }) : t("form.newTitle")}
      description={t("form.description")}
      width={520}
    >
      <form onSubmit={onSubmit} noValidate className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <div className="col-span-full">
          <Field label={t("form.account")} htmlFor={`${id}-account`}>
            <Select id={`${id}-account`} name="account" defaultValue={draft.accountId}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t("form.validFrom")} htmlFor={`${id}-from`}>
          <Input id={`${id}-from`} name="from" type="date" required defaultValue={draft.validFrom} />
        </Field>
        <Field label={t("form.validTo")} htmlFor={`${id}-to`}>
          <Input id={`${id}-to`} name="to" type="date" defaultValue={draft.validTo} />
        </Field>

        <fieldset className="col-span-full flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium">{t("form.tiers")}</legend>
          <div className="grid grid-cols-[1fr_1fr_28px] gap-2 text-xs text-muted">
            <span>{t("form.upTo")}</span>
            <span>{t("form.rate")}</span>
          </div>
          {tiers.map((tier, index) => {
            const last = index === tiers.length - 1;
            return (
              <div
                key={index}
                className="grid grid-cols-[1fr_1fr_28px] items-center gap-2"
                data-testid="tier"
              >
                {last ? (
                  <span className="flex h-8 items-center rounded-ctl border border-border bg-hover px-2.5 text-muted">
                    {t("form.above")}
                  </span>
                ) : (
                  <InputGroup suffix="€">
                    <Input
                      aria-label={`${t("form.upTo")} ${index + 1}`}
                      inputMode="decimal"
                      numeric
                      value={tier.upTo}
                      onChange={(event) => setTier(index, "upTo", event.target.value)}
                    />
                  </InputGroup>
                )}
                <InputGroup suffix="%">
                  <Input
                    aria-label={`${t("form.rate")} ${index + 1}`}
                    inputMode="decimal"
                    numeric
                    value={tier.rate}
                    onChange={(event) => setTier(index, "rate", event.target.value)}
                  />
                </InputGroup>
                {!last && (
                  <button
                    type="button"
                    aria-label={t("form.removeTier")}
                    onClick={() => setTiers((current) => current.filter((_, i) => i !== index))}
                    className="focus-ring grid size-7 place-items-center rounded-[5px] text-muted hover:bg-hover"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
          <LinkButton
            type="button"
            className="self-start"
            onClick={() =>
              setTiers((current) => [...current.slice(0, -1), { upTo: "", rate: "" }, ...current.slice(-1)])
            }
          >
            {t("form.addTier")}
          </LinkButton>
        </fieldset>

        <Field label={t("form.tax")} htmlFor={`${id}-tax`}>
          <InputGroup suffix="%">
            <Input id={`${id}-tax`} name="tax" inputMode="decimal" numeric defaultValue={draft.tax} />
          </InputGroup>
        </Field>
        <Field label={t("form.basis")} htmlFor={`${id}-basis`}>
          <Select id={`${id}-basis`} name="basis" defaultValue={draft.dayBasis}>
            <option value="365">{t("basis.365")}</option>
            <option value="360">{t("basis.360")}</option>
          </Select>
        </Field>
        <Field label={t("form.payout")} htmlFor={`${id}-settlement`}>
          <Select id={`${id}-settlement`} name="settlement" defaultValue={draft.settlement}>
            <option value="daily">{t("settlement.daily")}</option>
            <option value="monthly">{t("settlement.monthly")}</option>
            <option value="quarterly">{t("settlement.quarterly")}</option>
            <option value="annual">{t("settlement.annual")}</option>
          </Select>
        </Field>
        <Field label={t("form.match")} htmlFor={`${id}-match`} hint={t("form.matchHint")}>
          <Input id={`${id}-match`} name="match" maxLength={80} defaultValue={draft.payeeMatch} />
        </Field>
        <div className="col-span-full flex flex-col gap-2">
          <Checkbox name="publish" defaultChecked={draft.publish} label={t("form.publish")} />
          <p className="text-xs text-faint">{t("form.publishHint")}</p>
          <Checkbox name="active" defaultChecked={draft.active} label={t("form.active")} />
        </div>
        {error && (
          <p role="alert" className="col-span-full text-sm text-neg">
            {error}
          </p>
        )}
        <div className="col-span-full flex justify-end gap-2">
          <Button onClick={onClose}>{t("form.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {t("form.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** A button that opens the dialog on `draft`. */
export function RuleButton({
  draft,
  accounts,
  label,
  variant = "primary",
  size = "sm",
}: {
  draft: RuleDraft;
  accounts: readonly { id: string; name: string }[];
  label: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "xs" | "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && <RuleDialog draft={draft} accounts={accounts} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Pause or resume from the rule's page. */
export function RuleStateButton({
  id,
  state,
  label,
  toast,
}: {
  id: string;
  state: "active" | "paused";
  label: string;
  toast: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setRuleStateAction(id, state);
          if (result.ok) notify(toast);
        })
      }
    >
      {label}
    </Button>
  );
}
